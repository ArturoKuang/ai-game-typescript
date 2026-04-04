/**
 * NpcAutonomyManager — top-level coordinator for the NPC autonomy system.
 *
 * Hooks into GameLoop.onAfterTick() and, for each NPC:
 * 1. Skip if conversing (orchestrator handles it)
 * 2. Decay needs
 * 3. Check for critical need crossings → interrupt current plan
 * 4. If no plan → trigger goal selection → run GOAP planner
 * 5. Execute current plan step
 * 6. Idle wander fallback if no plan found
 */
import type { GameLoop } from "../engine/gameLoop.js";
import type { Position, TickResult } from "../engine/types.js";
import type { MemoryManager } from "../npc/memory.js";
import type { NpcModelProvider } from "../npc/provider.js";
import { registerBuiltinActions } from "./actions/index.js";
import type { EntityManager } from "./entityManager.js";
import { executeAutonomyTick, invalidatePlan } from "./executor.js";
import {
  selectGoalScripted,
  goalIdToState,
  buildGoalOptions,
} from "./goalSelector.js";
import { createInventory } from "./inventory.js";
import { boostNeed, createDefaultNeeds, hasCriticalNeed, tickNeeds, getUrgentNeeds } from "./needs.js";
import { plan } from "./planner.js";
import { ActionRegistry } from "./registry.js";
import type {
  GameLoopInterface,
  NeedConfig,
  NeedType,
  NpcAutonomyState,
  WorldState,
  GoalOption,
} from "./types.js";
import { DEFAULT_NEED_CONFIGS } from "./types.js";
import { snapshotWorldState } from "./worldState.js";

/** Minimum ticks between goal selection attempts per NPC. */
const GOAL_SELECTION_COOLDOWN = 200;
/** Idle wander range in tiles. */
const WANDER_RANGE = 5;
/** Ticks to wait after idle wander before trying to plan again. */
const IDLE_WAIT_MIN = 40;
const IDLE_WAIT_MAX = 100;
/** Max consecutive plan failures before extended idle. */
const MAX_CONSECUTIVE_FAILURES = 3;
/** Extended idle wait after too many failures. */
const EXTENDED_IDLE_WAIT = 200;
/** Social need boost when conversation ends. */
const SOCIAL_CONVERSATION_BOOST = 40;

export interface NpcAutonomyManagerOptions {
  needConfigs?: Record<NeedType, NeedConfig>;
  provider?: NpcModelProvider;
  memoryManager?: MemoryManager;
}

export class NpcAutonomyManager {
  private states: Map<string, NpcAutonomyState> = new Map();
  private registry: ActionRegistry;
  private needConfigs: Record<NeedType, NeedConfig>;
  private game: GameLoop;
  private entityManager: EntityManager;
  private provider?: NpcModelProvider;
  private memoryManager?: MemoryManager;
  private goalSelectionInFlight: Set<string> = new Set();
  /** Track which NPCs are in idle-wander cooldown and when it expires. */
  private idleCooldowns: Map<string, number> = new Map();

  constructor(
    game: GameLoop,
    entityManager: EntityManager,
    options: NpcAutonomyManagerOptions = {},
  ) {
    this.game = game;
    this.entityManager = entityManager;
    this.needConfigs = options.needConfigs ?? DEFAULT_NEED_CONFIGS;
    this.provider = options.provider;
    this.memoryManager = options.memoryManager;

    this.registry = new ActionRegistry();
    registerBuiltinActions(this.registry);

    // Hook into after-tick (runs after orchestrator)
    this.game.onAfterTick((result: TickResult) => {
      this.processAutonomyTick(result);
    });

    // Boost social need when conversations end
    this.game.on("convo_ended", (event) => {
      if (!event.data) return;
      const conversation = event.data.conversation as {
        player1Id?: string;
        player2Id?: string;
      } | undefined;
      if (!conversation) return;
      for (const pid of [conversation.player1Id, conversation.player2Id]) {
        if (!pid) continue;
        const state = this.states.get(pid);
        if (state) {
          boostNeed(state.needs, "social", SOCIAL_CONVERSATION_BOOST);
        }
      }
    });
  }

  /** Get or create autonomy state for an NPC. */
  getState(npcId: string): NpcAutonomyState {
    let state = this.states.get(npcId);
    if (!state) {
      state = {
        needs: createDefaultNeeds(this.needConfigs),
        inventory: createInventory(),
        currentPlan: null,
        currentStepIndex: 0,
        currentExecution: null,
        lastPlanTick: 0,
        lastGoalSelectionTick: 0,
        consecutivePlanFailures: 0,
      };
      this.states.set(npcId, state);
    }
    return state;
  }

  /** Get all NPC autonomy states (for debug API). */
  getAllStates(): Map<string, NpcAutonomyState> {
    return this.states;
  }

  /** Get the entity manager (for debug API). */
  getEntityManager(): EntityManager {
    return this.entityManager;
  }

  private processAutonomyTick(_result: TickResult): void {
    const npcs = this.game.getPlayers().filter((p) => p.isNpc);

    for (const npc of npcs) {
      const state = this.getState(npc.id);

      // 1. Skip conversing NPCs — orchestrator handles them
      if (npc.state === "conversing") {
        // Still decay needs while conversing (except social gets boosted on end)
        tickNeeds(state.needs, this.needConfigs);
        continue;
      }

      // 2. Decay needs
      const needsResult = tickNeeds(state.needs, this.needConfigs);

      // 3. Check for critical need crossing → interrupt current plan
      if (
        needsResult.newCritical.length > 0 &&
        state.currentPlan
      ) {
        invalidatePlan(
          npc.id,
          state,
          this.registry,
          this.game as unknown as GameLoopInterface,
          this.entityManager,
          `Critical need: ${needsResult.newCritical.join(", ")}`,
        );
      }

      // Check idle cooldown
      const cooldownExpiry = this.idleCooldowns.get(npc.id);
      if (cooldownExpiry && this.game.currentTick < cooldownExpiry) {
        continue; // Waiting in idle wander
      }
      this.idleCooldowns.delete(npc.id);

      // 4. If no plan, try to select goal and plan
      if (!state.currentPlan) {
        this.tryPlan(npc.id, state);
      }

      // 5. Execute current plan step
      if (state.currentPlan) {
        const result = executeAutonomyTick(
          npc.id,
          state,
          this.registry,
          this.game as unknown as GameLoopInterface,
          this.entityManager,
        );

        if (result.planFailed) {
          state.consecutivePlanFailures++;
          if (state.consecutivePlanFailures >= MAX_CONSECUTIVE_FAILURES) {
            // Extended idle
            this.idleCooldowns.set(
              npc.id,
              this.game.currentTick + EXTENDED_IDLE_WAIT,
            );
            state.consecutivePlanFailures = 0;
          }
        } else if (result.planCompleted) {
          state.consecutivePlanFailures = 0;
        }
      }
    }
  }

  private tryPlan(npcId: string, state: NpcAutonomyState): void {
    const tick = this.game.currentTick;

    // Throttle goal selection
    if (tick - state.lastGoalSelectionTick < GOAL_SELECTION_COOLDOWN) {
      this.idleWander(npcId, state);
      return;
    }

    // Check if any needs are urgent
    const urgent = getUrgentNeeds(state.needs, this.needConfigs);
    if (urgent.length === 0 && !hasCriticalNeed(state.needs, this.needConfigs)) {
      // Nothing urgent — idle wander
      this.idleWander(npcId, state);
      return;
    }

    state.lastGoalSelectionTick = tick;

    // Use scripted goal selection (synchronous)
    // LLM goal selection is async and handled separately
    const goalResult = selectGoalScripted(state.needs);
    if (!goalResult) {
      this.idleWander(npcId, state);
      return;
    }

    // Try async LLM goal selection if provider supports it
    if (this.provider && !this.goalSelectionInFlight.has(npcId)) {
      this.tryLlmGoalSelection(npcId, state, goalResult.goalState);
    }

    // Meanwhile, plan with scripted goal
    this.executePlan(npcId, state, goalResult.goalState, goalResult.goalId);
  }

  private async tryLlmGoalSelection(
    npcId: string,
    state: NpcAutonomyState,
    fallbackGoal: WorldState,
  ): Promise<void> {
    if (!this.provider) return;
    if (!this.provider.generateGoalSelection) return;

    this.goalSelectionInFlight.add(npcId);
    try {
      const npc = this.game.getPlayer(npcId);
      if (!npc) return;

      const options = buildGoalOptions(state.needs);
      const nearbyEntities = this.entityManager
        .getNearby({ x: Math.round(npc.x), y: Math.round(npc.y) }, 10)
        .slice(0, 5)
        .map((e) => ({
          type: e.type,
          distance:
            Math.abs(e.position.x - npc.x) +
            Math.abs(e.position.y - npc.y),
          name: e.id,
        }));

      const response = await this.provider!.generateGoalSelection!({
        npc: npc as any,
        needs: state.needs,
        inventory: Object.fromEntries(state.inventory),
        nearbyEntities,
        recentMemories: [],
        availableGoals: options,
        currentTick: this.game.currentTick,
      });

      if (response && response.goalId) {
        // Store reasoning as observation memory
        if (response.reasoning && this.memoryManager) {
          this.memoryManager.addMemory({
            playerId: npcId,
            type: "observation",
            content: `I decided to ${response.goalId.replace("satisfy_", "address my ")}: ${response.reasoning}`,
            importance: 3,
            tick: this.game.currentTick,
          }).catch((err) => {
            console.warn(`Failed to store goal reasoning for ${npcId}:`, err);
          });
        }

        const goalState = goalIdToState(response.goalId);
        if (goalState) {
          // Replace current plan with LLM-selected goal
          this.executePlan(npcId, state, goalState, response.goalId);
        }
      }
    } catch (error) {
      console.warn(`LLM goal selection failed for ${npcId}:`, error);
      // Scripted fallback already ran
    } finally {
      this.goalSelectionInFlight.delete(npcId);
    }
  }

  private executePlan(
    npcId: string,
    state: NpcAutonomyState,
    goalState: WorldState,
    goalId: string,
  ): void {
    const npc = this.game.getPlayer(npcId);
    if (!npc) return;

    const currentState = snapshotWorldState(
      npcId,
      this.game as unknown as GameLoopInterface,
      state.needs,
      state.inventory,
      this.entityManager,
    );

    const result = plan(currentState, goalState, this.registry, {
      npcId,
      currentState,
      entityManager: this.entityManager,
      npcPosition: { x: Math.round(npc.x), y: Math.round(npc.y) },
    });

    if (result) {
      result.createdAtTick = this.game.currentTick;
      result.goalId = goalId;
      state.currentPlan = result;
      state.currentStepIndex = 0;
      state.currentExecution = null;
      state.lastPlanTick = this.game.currentTick;
    } else {
      this.idleWander(npcId, state);
    }
  }

  private idleWander(npcId: string, _state: NpcAutonomyState): void {
    const npc = this.game.getPlayer(npcId);
    if (!npc) return;
    if (npc.state === "walking") return; // Already moving

    // Pick a random walkable tile within WANDER_RANGE
    const world = this.game.world;
    const cx = Math.round(npc.x);
    const cy = Math.round(npc.y);

    // Simple random walk target
    for (let attempt = 0; attempt < 5; attempt++) {
      const dx = Math.floor(Math.random() * (WANDER_RANGE * 2 + 1)) - WANDER_RANGE;
      const dy = Math.floor(Math.random() * (WANDER_RANGE * 2 + 1)) - WANDER_RANGE;
      const tx = cx + dx;
      const ty = cy + dy;

      if (world.isWalkable(tx, ty)) {
        this.game.setPlayerTarget(npcId, tx, ty);
        break;
      }
    }

    // Set idle cooldown
    const wait = IDLE_WAIT_MIN + Math.floor(Math.random() * (IDLE_WAIT_MAX - IDLE_WAIT_MIN));
    this.idleCooldowns.set(npcId, this.game.currentTick + wait);
  }
}
