/**
 * NpcAutonomyManager — top-level coordinator for the NPC autonomy system.
 *
 * Hooks into GameLoop.onAfterTick() and, for each NPC:
 * 1. Evaluate pending conversation invites and skip active conversations
 * 2. Decay needs
 * 3. Check for critical need crossings → interrupt current plan
 * 4. If no plan → trigger goal selection → run GOAP planner
 * 5. Execute current plan step
 * 6. Idle wander fallback if no plan found
 */
import type {
  Conversation,
  NpcInviteDecision,
} from "../engine/conversation.js";
import type { GameLoop } from "../engine/gameLoop.js";
import type { CharacterDef, Command, Position, TickResult } from "../engine/types.js";
import type { MemoryManager } from "../npc/memory.js";
import type { NpcModelProvider } from "../npc/provider.js";
import { registerBuiltinActions } from "./actions/index.js";
import type { EntityManager } from "./entityManager.js";
import { executeAutonomyTick, invalidatePlan } from "./executor.js";
import {
  buildGoalOptions,
  goalIdToState,
  selectGoalScripted,
} from "./goalSelector.js";
import { createInventory } from "./inventory.js";
import {
  boostNeed,
  createDefaultNeeds,
  getUrgentNeeds,
  hasCriticalNeed,
  tickNeeds,
} from "./needs.js";
import { plan } from "./planner.js";
import { ActionRegistry } from "./registry.js";
import type {
  GameLoopInterface,
  GoalOption,
  NeedConfig,
  NeedType,
  NpcAutonomyState,
  WorldState,
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
/** How often to broadcast needs to clients (ticks). */
const NEEDS_BROADCAST_INTERVAL = 40;
/** Safety drop when a bear is detected nearby. */
const SAFETY_THREAT_DROP = 20;
/** Safety drop when NPC takes damage. */
const SAFETY_DAMAGE_DROP = 40;
/** Safety recovery per tick when no threats are nearby. */
const SAFETY_RECOVERY_PER_TICK = 0.05;
/** Radius to scan for bears. */
const BEAR_DETECTION_RADIUS = 5;
/** Max ticks an NPC will leave a player invite pending before declining it. */
const INVITE_DECISION_TIMEOUT = 120;

export interface NpcAutonomyManagerOptions {
  needConfigs?: Record<NeedType, NeedConfig>;
  provider?: NpcModelProvider;
  memoryManager?: MemoryManager;
  characters?: CharacterDef[];
}

export class NpcAutonomyManager {
  private states: Map<string, NpcAutonomyState> = new Map();
  private registry: ActionRegistry;
  private needConfigs: Record<NeedType, NeedConfig>;
  private game: GameLoop;
  private entityManager: EntityManager;
  private provider?: NpcModelProvider;
  private memoryManager?: MemoryManager;
  /** Per-NPC need config overrides from character definitions. */
  private perNpcConfigs: Map<string, Record<NeedType, NeedConfig>> = new Map();
  private goalSelectionInFlight: Set<string> = new Set();
  /** Track which NPCs are in idle-wander cooldown and when it expires. */
  private idleCooldowns: Map<string, number> = new Map();
  private needsListeners: Array<
    (
      npcId: string,
      needs: {
        hunger: number;
        energy: number;
        social: number;
        safety: number;
        curiosity: number;
      },
    ) => void
  > = [];

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

    // Build per-NPC configs from character overrides
    if (options.characters) {
      for (const char of options.characters) {
        if (char.needOverrides) {
          const config = { ...this.needConfigs };
          const o = char.needOverrides;
          if (o.hungerDecay !== undefined)
            config.hunger = { ...config.hunger, decayPerTick: o.hungerDecay };
          if (o.energyDecay !== undefined)
            config.energy = { ...config.energy, decayPerTick: o.energyDecay };
          if (o.socialDecay !== undefined)
            config.social = { ...config.social, decayPerTick: o.socialDecay };
          if (o.curiosityDecay !== undefined)
            config.curiosity = {
              ...config.curiosity,
              decayPerTick: o.curiosityDecay,
            };
          this.perNpcConfigs.set(char.id, config);
        }
      }
    }

    this.registry = new ActionRegistry();
    registerBuiltinActions(this.registry);
    this.game.setNpcInviteDecisionProvider((conversation, inviter, invitee) =>
      this.decideNpcInvite(conversation, inviter.id, invitee.id),
    );

    // Hook into after-tick (runs after orchestrator)
    this.game.onAfterTick((result: TickResult) => {
      this.processAutonomyTick(result);
    });

    // Drop safety when NPC takes damage
    this.game.on("player_damage", (event) => {
      if (!event.playerId) return;
      const state = this.states.get(event.playerId);
      if (state) {
        state.needs.safety = Math.max(
          0,
          state.needs.safety - SAFETY_DAMAGE_DROP,
        );
      }
    });

    // Boost social need when conversations end
    this.game.on("convo_ended", (event) => {
      if (!event.data) return;
      const conversation = event.data.conversation as
        | {
            player1Id?: string;
            player2Id?: string;
          }
        | undefined;
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

  /** Register a listener for NPC needs updates (used for client broadcasting). */
  onNeedsUpdate(
    listener: (
      npcId: string,
      needs: {
        hunger: number;
        energy: number;
        social: number;
        safety: number;
        curiosity: number;
      },
    ) => void,
  ): void {
    this.needsListeners.push(listener);
  }

  /** Get need configs for an NPC (per-character or default). */
  private getNeedConfigs(npcId: string): Record<NeedType, NeedConfig> {
    return this.perNpcConfigs.get(npcId) ?? this.needConfigs;
  }

  private updateSafetyFromThreats(
    npc: { id: string; x: number; y: number },
    state: NpcAutonomyState,
  ): void {
    const pos = { x: Math.round(npc.x), y: Math.round(npc.y) };
    const bears = this.entityManager.getNearby(
      pos,
      BEAR_DETECTION_RADIUS,
      "bear",
    );
    const activeBear = bears.find(
      (b) => !b.destroyed && b.properties.state !== "dead",
    );

    if (activeBear) {
      // Threat detected — drop safety based on proximity
      const dist =
        Math.abs(activeBear.position.x - pos.x) +
        Math.abs(activeBear.position.y - pos.y);
      // Closer = bigger drop. At dist 1: full drop. At dist 5: small drop.
      const proximityFactor = 1 - (dist - 1) / BEAR_DETECTION_RADIUS;
      const drop = SAFETY_THREAT_DROP * Math.max(0.2, proximityFactor);
      state.needs.safety = Math.max(0, state.needs.safety - drop * 0.1); // per-tick rate
    } else if (state.needs.safety < 100) {
      // No threats — slowly recover safety
      state.needs.safety = Math.min(
        100,
        state.needs.safety + SAFETY_RECOVERY_PER_TICK,
      );
    }
  }

  private broadcastNeeds(npcId: string, state: NpcAutonomyState): void {
    const { hunger, energy, social, safety, curiosity } = state.needs;
    for (const listener of this.needsListeners) {
      listener(npcId, { hunger, energy, social, safety, curiosity });
    }
  }

  private processAutonomyTick(_result: TickResult): void {
    const npcs = this.game.getPlayers().filter((p) => p.isNpc);
    const shouldBroadcast =
      this.game.currentTick % NEEDS_BROADCAST_INTERVAL === 0;

    for (const npc of npcs) {
      const state = this.getState(npc.id);

      const npcConfigs = this.getNeedConfigs(npc.id);

      // 1. Once a conversation is active, the social action owns the NPC.
      if (npc.state === "conversing") {
        tickNeeds(state.needs, npcConfigs);
        if (shouldBroadcast) this.broadcastNeeds(npc.id, state);
        continue;
      }

      // 2. Decay needs
      const needsResult = tickNeeds(state.needs, npcConfigs);

      // 2b. Safety threat detection — scan for nearby bears
      this.updateSafetyFromThreats(npc, state);

      // 3. Check for critical need crossing → interrupt current plan
      if (needsResult.newCritical.length > 0 && state.currentPlan) {
        invalidatePlan(
          npc.id,
          state,
          this.registry,
          this.game as unknown as GameLoopInterface,
          this.entityManager,
          `Critical need: ${needsResult.newCritical.join(", ")}`,
        );
      }

      // 3b. Emergency flee — bypass all cooldowns when safety is critical
      //     and NPC is not already fleeing
      if (
        state.needs.safety < npcConfigs.safety.criticalThreshold &&
        (!state.currentPlan || state.currentPlan.goalId !== "satisfy_safety")
      ) {
        // Cancel current plan and immediately plan a flee
        if (state.currentPlan) {
          invalidatePlan(
            npc.id, state, this.registry,
            this.game as unknown as GameLoopInterface,
            this.entityManager, "Emergency flee",
          );
        }
        this.idleCooldowns.delete(npc.id);
        const fleeGoal: WorldState = new Map([["need_safety_satisfied", true]]);
        this.executePlan(npc.id, state, fleeGoal, "satisfy_safety");
        // Skip normal planning — go straight to execution
        if (state.currentPlan) {
          const result = executeAutonomyTick(
            npc.id, state, this.registry,
            this.game as unknown as GameLoopInterface, this.entityManager,
          );
          if (result.planCompleted) state.consecutivePlanFailures = 0;
        }
        if (shouldBroadcast) this.broadcastNeeds(npc.id, state);
        continue;
      }

      // Check idle cooldown
      const cooldownExpiry = this.idleCooldowns.get(npc.id);
      if (cooldownExpiry && this.game.currentTick < cooldownExpiry) {
        if (shouldBroadcast) this.broadcastNeeds(npc.id, state);
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

      // 6. Broadcast needs to clients periodically
      if (shouldBroadcast) this.broadcastNeeds(npc.id, state);
    }
  }

  private decideNpcInvite(
    conversation: Conversation,
    inviterId: string,
    inviteeId: string,
  ): NpcInviteDecision {
    const state = this.getState(inviteeId);
    const configs = this.getNeedConfigs(inviteeId);

    if (!state.currentPlan) {
      return "accept";
    }

    const currentNeed = this.needTypeForGoal(state.currentPlan.goalId);
    if (currentNeed === "social") {
      return "accept";
    }

    const inviter = this.game.getPlayer(inviterId);
    const invitee = this.game.getPlayer(inviteeId);
    const socialPressure =
      this.needPressure("social", state.needs.social, configs) +
      this.inviteDistanceBoost(inviter, invitee);

    if (currentNeed === null) {
      if (socialPressure >= 0.75) {
        return "accept";
      }
      return this.inviteTimedOut(conversation) ? "decline" : "wait";
    }

    const currentPressure = this.needPressure(
      currentNeed,
      state.needs[currentNeed],
      configs,
    );

    if (socialPressure + 0.1 >= currentPressure) {
      return "accept";
    }

    return this.inviteTimedOut(conversation) ? "decline" : "wait";
  }

  private needTypeForGoal(goalId: string | undefined): NeedType | null {
    switch (goalId) {
      case "satisfy_hunger":
        return "hunger";
      case "satisfy_energy":
        return "energy";
      case "satisfy_social":
        return "social";
      case "satisfy_safety":
        return "safety";
      case "satisfy_curiosity":
        return "curiosity";
      default:
        return null;
    }
  }

  private needPressure(
    need: NeedType,
    value: number,
    configs: Record<NeedType, NeedConfig>,
  ): number {
    const config = configs[need];
    if (value <= config.criticalThreshold) {
      return (
        2 +
        (config.criticalThreshold - value) /
          Math.max(1, config.criticalThreshold)
      );
    }
    if (value < config.urgencyThreshold) {
      return (
        1 +
        (config.urgencyThreshold - value) /
          Math.max(1, config.urgencyThreshold - config.criticalThreshold)
      );
    }
    return (
      ((config.initialValue - value) / Math.max(1, config.initialValue)) * 0.25
    );
  }

  private inviteDistanceBoost(
    inviter: Position | undefined,
    invitee: Position | undefined,
  ): number {
    if (!inviter || !invitee) {
      return 0;
    }

    const distance =
      Math.abs(inviter.x - invitee.x) + Math.abs(inviter.y - invitee.y);
    if (distance <= 2) return 0.4;
    if (distance <= 6) return 0.15;
    return 0;
  }

  private inviteTimedOut(conversation: Conversation): boolean {
    return this.game.currentTick - conversation.startedTick >= INVITE_DECISION_TIMEOUT;
  }

  private tryPlan(npcId: string, state: NpcAutonomyState): void {
    const tick = this.game.currentTick;

    // Throttle goal selection
    if (tick - state.lastGoalSelectionTick < GOAL_SELECTION_COOLDOWN) {
      this.idleWander(npcId, state);
      return;
    }

    // Check if any needs are urgent
    const npcConfigs = this.getNeedConfigs(npcId);
    const urgent = getUrgentNeeds(state.needs, npcConfigs);
    if (urgent.length === 0 && !hasCriticalNeed(state.needs, npcConfigs)) {
      this.idleWander(npcId, state);
      return;
    }

    state.lastGoalSelectionTick = tick;

    const goalResult = selectGoalScripted(state.needs, npcConfigs);
    if (!goalResult) {
      this.idleWander(npcId, state);
      return;
    }

    // Start executing the scripted goal immediately so the NPC isn't idle.
    // If an LLM provider is available, fire off an async goal selection that
    // may replace this plan once it resolves (see tryLlmGoalSelection).
    this.executePlan(npcId, state, goalResult.goalState, goalResult.goalId);

    if (this.provider && !this.goalSelectionInFlight.has(npcId)) {
      this.tryLlmGoalSelection(npcId, state, tick);
    }
  }

  /**
   * Fire-and-forget async LLM goal selection. If the LLM picks a different
   * goal than the scripted fallback, the current plan is replaced — but only
   * if no higher-priority plan change (e.g. emergency flee, new critical need)
   * has occurred while the request was in flight.
   */
  private async tryLlmGoalSelection(
    npcId: string,
    state: NpcAutonomyState,
    requestTick: number,
  ): Promise<void> {
    if (!this.provider?.generateGoalSelection) return;

    this.goalSelectionInFlight.add(npcId);
    try {
      const npc = this.game.getPlayer(npcId);
      if (!npc) return;

      const options = buildGoalOptions(state.needs, this.getNeedConfigs(npcId));
      const nearbyEntities = this.entityManager
        .getNearby({ x: Math.round(npc.x), y: Math.round(npc.y) }, 10)
        .slice(0, 5)
        .map((e) => ({
          type: e.type,
          distance:
            Math.abs(e.position.x - npc.x) + Math.abs(e.position.y - npc.y),
          name: e.id,
        }));

      const response = await this.provider.generateGoalSelection({
        npc,
        needs: state.needs,
        inventory: Object.fromEntries(state.inventory),
        nearbyEntities,
        recentMemories: [],
        availableGoals: options,
        currentTick: this.game.currentTick,
      });

      if (!response?.goalId) return;

      // Race condition guard: if the plan was replaced after we fired this
      // request (e.g. by an emergency flee or a new critical-need interrupt),
      // the newer plan takes priority — don't clobber it.
      const planIsStale =
        state.lastGoalSelectionTick !== requestTick ||
        (state.currentPlan &&
          state.currentPlan.createdAtTick > requestTick);

      if (planIsStale) return;

      // Store reasoning as observation memory (fire-and-forget)
      if (response.reasoning && this.memoryManager) {
        this.memoryManager
          .addMemory({
            playerId: npcId,
            type: "observation",
            content: `I decided to ${response.goalId.replace("satisfy_", "address my ")}: ${response.reasoning}`,
            importance: 3,
            tick: this.game.currentTick,
          })
          .catch((err) => {
            console.warn(`Failed to store goal reasoning for ${npcId}:`, err);
          });
      }

      const goalState = goalIdToState(response.goalId);
      if (goalState) {
        this.executePlan(npcId, state, goalState, response.goalId);
      }
    } catch (error) {
      console.warn(`LLM goal selection failed for ${npcId}:`, error);
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
      this.getNeedConfigs(npcId),
    );

    const result = plan(currentState, goalState, this.registry, {
      npcId,
      currentState,
      entityManager: this.entityManager,
      npcPosition: { x: Math.round(npc.x), y: Math.round(npc.y) },
      otherPlayers: this.game
        .getPlayers()
        .filter((player) => player.id !== npcId)
        .map((player) => ({
          id: player.id,
          x: player.x,
          y: player.y,
          state: player.state,
          isNpc: player.isNpc,
        })),
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
    const rng = this.game.rng;
    const cx = Math.round(npc.x);
    const cy = Math.round(npc.y);

    // Simple random walk target
    for (let attempt = 0; attempt < 5; attempt++) {
      const dx = rng.nextInt(WANDER_RANGE * 2 + 1) - WANDER_RANGE;
      const dy = rng.nextInt(WANDER_RANGE * 2 + 1) - WANDER_RANGE;
      const tx = cx + dx;
      const ty = cy + dy;

      if (world.isWalkable(tx, ty)) {
        const moveCommand: Command = {
          type: "move_to",
          playerId: npcId,
          data: { x: tx, y: ty },
        };
        this.game.enqueue(moveCommand);
        break;
      }
    }

    // Set idle cooldown
    const wait =
      IDLE_WAIT_MIN + rng.nextInt(IDLE_WAIT_MAX - IDLE_WAIT_MIN);
    this.idleCooldowns.set(npcId, this.game.currentTick + wait);
  }
}
