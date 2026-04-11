import type { NpcPersistenceStore } from "../db/npcStore.js";
import type { Memory } from "../db/repository.js";
import type {
  DebugActionDefinition,
  DebugFeedEventPayload,
} from "../debug/streamTypes.js";
/**
 * NpcAutonomyManager — top-level coordinator for the NPC autonomy system.
 *
 * Hooks into GameLoop.onAfterTick() and, for each NPC:
 * 1. Evaluate pending conversation invites and skip active conversations
 * 2. Decay needs
 * 3. Check for critical need crossings → interrupt current plan
 * 4. If no plan → trigger goal selection → run GOAP planner
 * 5. Execute current plan step
 * 6. Route low-priority roaming through a GOAP wander plan
 */
import type {
  Conversation,
  NpcInviteDecision,
} from "../engine/conversation.js";
import { manhattanDistance } from "../engine/spatial.js";
import type { CharacterDef, Position, TickResult } from "../engine/types.js";
import type { MemoryManager } from "../npc/memory.js";
import type {
  NpcGoalRememberedTarget,
  NpcModelProvider,
} from "../npc/provider.js";
import { registerBuiltinActions } from "./actions/index.js";
import type { EntityManager } from "./entityManager.js";
import { executeAutonomyTick, invalidatePlan } from "./executor.js";
import {
  buildGoalOptions,
  goalIdToState,
  selectGoalScripted,
} from "./goalSelector.js";
import { addItem, createInventory, removeItem } from "./inventory.js";
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
  ActionHistoryEntry,
  AutonomyGameRuntime,
  AutonomyRuntimePlayer,
  GoalOption,
  NeedConfig,
  NeedType,
  NpcAutonomyDebugDeath,
  NpcAutonomyDebugPlan,
  NpcAutonomyDebugState,
  NpcAutonomyState,
  NpcNeeds,
  Plan,
  PlanSource,
  RememberedTarget,
  SurvivalSnapshot,
  WorldState,
} from "./types.js";
import { DEFAULT_NEED_CONFIGS } from "./types.js";
import { snapshotWorldState } from "./worldState.js";

/** Minimum ticks between goal selection attempts per NPC. */
const GOAL_SELECTION_COOLDOWN = 200;
/** Ticks to wait after idle wander before trying to plan again. */
const IDLE_WAIT_MIN = 40;
const IDLE_WAIT_MAX = 100;
/** Max consecutive plan failures before extended idle. */
const MAX_CONSECUTIVE_FAILURES = 3;
/** Extended idle wait after too many failures. */
const EXTENDED_IDLE_WAIT = 200;
/** Social need boost when conversation ends. */
const SOCIAL_CONVERSATION_BOOST = 40;
/** Food restored when a player consumes raw food. */
const PLAYER_RAW_FOOD_RESTORE = 40;
/** Food restored when a player consumes cooked food. */
const PLAYER_COOKED_FOOD_RESTORE = 70;
/** Food restored when a player consumes bear meat. */
const PLAYER_BEAR_MEAT_FOOD_RESTORE = 55;
/** How often to broadcast NPC needs to clients (ticks). */
const NPC_NEEDS_BROADCAST_INTERVAL = 40;
/** Human survival drives the local HUD, so keep it live every tick. */
const PLAYER_SURVIVAL_BROADCAST_INTERVAL = 1;
/** Max ticks an NPC will leave a player invite pending before declining it. */
const INVITE_DECISION_TIMEOUT = 120;
/** Number of memories to retrieve when selecting the next autonomy goal. */
const PLANNING_MEMORY_LIMIT = 5;
const GOAL_REMEMBERED_TARGET_LIMIT = 5;
/** Bounded recent action history used by the planner as working memory. */
const ACTION_HISTORY_LIMIT = 20;
const REMEMBERED_TARGET_LIMIT = 40;
const REMEMBERED_TARGET_TTL = 2000;
const OBSERVATION_RADIUS = 6;
const OBSERVATION_MEMORY_COOLDOWN = 300;
const GOAL_SELECTION_OBSERVATION_RADIUS = 10;
/** Passive water refill when standing by the pond edge. */
const POND_WATER_RESTORE_PER_TICK = 2;
/** NPC flee trigger radius for aggressive bears. */
const AGGRESSIVE_BEAR_RADIUS = 4;
/** Default health scale used by the survival UI. */
const DEFAULT_PLAYER_MAX_HP = 100;
type SurvivalNeed = keyof SurvivalSnapshot;

export interface NpcAutonomyManagerOptions {
  needConfigs?: Record<NeedType, NeedConfig>;
  provider?: NpcModelProvider;
  memoryManager?: MemoryManager;
  npcStore?: NpcPersistenceStore;
  persistedDeadNpcs?: NpcAutonomyDebugState[];
  characters?: CharacterDef[];
}

export class NpcAutonomyManager {
  private states: Map<string, NpcAutonomyState> = new Map();
  private playerSurvival: Map<string, SurvivalSnapshot> = new Map();
  private registry: ActionRegistry;
  private needConfigs: Record<NeedType, NeedConfig>;
  private game: AutonomyGameRuntime;
  private entityManager: EntityManager;
  private provider?: NpcModelProvider;
  private memoryManager?: MemoryManager;
  private npcStore?: NpcPersistenceStore;
  /** Per-NPC need config overrides from character definitions. */
  private perNpcConfigs: Map<string, Record<NeedType, NeedConfig>> = new Map();
  private goalSelectionInFlight: Set<string> = new Set();
  /** Track which NPCs are in idle-wander cooldown and when it expires. */
  private idleCooldowns: Map<string, number> = new Map();
  private deadDebugStates: Map<string, NpcAutonomyDebugState> = new Map();
  private needsListeners: Array<
    (npcId: string, needs: SurvivalSnapshot) => void
  > = [];
  private playerSurvivalListeners: Array<
    (playerId: string, needs: SurvivalSnapshot) => void
  > = [];
  private debugStateListeners: Array<(state: NpcAutonomyDebugState) => void> =
    [];
  private debugEventListeners: Array<(event: DebugFeedEventPayload) => void> =
    [];
  private debugStateHashes: Map<string, string> = new Map();

  constructor(
    game: AutonomyGameRuntime,
    entityManager: EntityManager,
    options: NpcAutonomyManagerOptions = {},
  ) {
    this.game = game;
    this.entityManager = entityManager;
    this.needConfigs = options.needConfigs ?? DEFAULT_NEED_CONFIGS;
    this.provider = options.provider;
    this.memoryManager = options.memoryManager;
    this.npcStore = options.npcStore;
    for (const deadState of options.persistedDeadNpcs ?? []) {
      this.deadDebugStates.set(deadState.npcId, structuredClone(deadState));
    }

    // Build per-NPC configs from character overrides
    if (options.characters) {
      for (const char of options.characters) {
        if (char.needOverrides) {
          const config = { ...this.needConfigs };
          const o = char.needOverrides;
          if (o.foodDecay !== undefined)
            config.food = { ...config.food, decayPerTick: o.foodDecay };
          if (o.waterDecay !== undefined)
            config.water = { ...config.water, decayPerTick: o.waterDecay };
          if (o.socialDecay !== undefined)
            config.social = { ...config.social, decayPerTick: o.socialDecay };
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

    this.game.on("player_damage", (event) => {
      if (!event.playerId) return;
      this.broadcastCurrentSurvival(event.playerId);
    });

    this.game.on("player_heal", (event) => {
      if (!event.playerId) return;
      this.broadcastCurrentSurvival(event.playerId);
    });

    this.game.on("player_death", (event) => {
      if (!event.playerId) return;
      this.broadcastCurrentSurvival(event.playerId);
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
        this.boostPlayerNeed(pid, "social", SOCIAL_CONVERSATION_BOOST);
      }
    });

    // Restore food when a player consumes an edible item.
    this.game.on("item_consumed", (event) => {
      if (!event.playerId || typeof event.data?.item !== "string") return;
      const player = this.game.getPlayer(event.playerId);
      if (player?.isNpc) {
        removeItem(this.getState(event.playerId).inventory, event.data.item);
      }
      const restore = this.foodRestoreForItem(event.data.item);
      if (restore <= 0) return;
      this.boostPlayerNeed(event.playerId, "food", restore);
    });

    this.game.on("item_pickup", (event) => {
      if (!event.playerId || typeof event.data?.item !== "string") return;
      const player = this.game.getPlayer(event.playerId);
      if (!player?.isNpc) return;
      const quantity =
        typeof event.data.quantity === "number" ? event.data.quantity : 1;
      addItem(
        this.getState(event.playerId).inventory,
        event.data.item,
        quantity,
      );
    });

    this.game.on("spawn", (event) => {
      if (!event.playerId) return;
      const player = this.game.getPlayer(event.playerId);
      if (player?.isNpc) {
        this.deadDebugStates.delete(event.playerId);
        this.debugStateHashes.delete(event.playerId);
        this.publishDebugStateIfChanged(
          event.playerId,
          this.getState(event.playerId),
        );
      }
      this.broadcastCurrentSurvival(event.playerId);
    });

    this.game.on("despawn", (event) => {
      if (!event.playerId) return;
      this.playerSurvival.delete(event.playerId);
      this.states.delete(event.playerId);
      this.goalSelectionInFlight.delete(event.playerId);
      this.idleCooldowns.delete(event.playerId);
      const deadState = this.deadDebugStates.get(event.playerId);
      if (deadState && event.data?.reason === "death") {
        this.debugStateHashes.set(event.playerId, JSON.stringify(deadState));
      } else {
        this.debugStateHashes.delete(event.playerId);
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
        recentActionHistory: [],
        rememberedTargets: [],
        lastObservationTickByKey: new Map(),
        currentPlan: null,
        currentPlanSource: null,
        currentPlanReasoning: null,
        currentStepIndex: 0,
        currentExecution: null,
        lastPlanTick: 0,
        lastGoalSelectionTick: 0,
        consecutivePlanFailures: 0,
        goalSelectionStartedAtTick: null,
      };
      this.states.set(npcId, state);
    }
    return state;
  }

  /** Get all NPC autonomy states (for debug API). */
  getAllStates(): Map<string, NpcAutonomyState> {
    return this.states;
  }

  /** Serialize one NPC autonomy state with readable action labels for debug UI. */
  getDebugState(npcId: string): NpcAutonomyDebugState | undefined {
    const state = this.states.get(npcId);
    if (state) {
      return this.buildDebugState(npcId, state);
    }
    const deadState = this.deadDebugStates.get(npcId);
    return deadState ? structuredClone(deadState) : undefined;
  }

  /** Serialize all NPC autonomy states for the debug API. */
  getAllDebugStates(): Map<string, NpcAutonomyDebugState> {
    const result = new Map<string, NpcAutonomyDebugState>();
    for (const [npcId, state] of this.deadDebugStates) {
      result.set(npcId, structuredClone(state));
    }
    for (const [npcId, state] of this.states) {
      result.set(npcId, this.buildDebugState(npcId, state));
    }
    return result;
  }

  /** Serialize all action definitions for the debug dashboard. */
  getActionDefinitions(): Record<string, DebugActionDefinition> {
    const result: Record<string, DebugActionDefinition> = {};
    for (const action of this.registry.getAll()) {
      const cost = typeof action.cost === "function" ? 0 : action.cost;
      result[action.id] = {
        id: action.id,
        displayName: action.displayName,
        preconditions: Object.fromEntries(action.preconditions),
        effects: Object.fromEntries(action.effects),
        cost,
        estimatedDurationTicks: action.estimatedDurationTicks,
        proximityRequirement: action.proximityRequirement,
      };
    }
    return result;
  }

  /** Get the entity manager (for debug API). */
  getEntityManager(): EntityManager {
    return this.entityManager;
  }

  reset(): void {
    this.states.clear();
    this.playerSurvival.clear();
    this.goalSelectionInFlight.clear();
    this.idleCooldowns.clear();
    this.deadDebugStates.clear();
    this.debugStateHashes.clear();
  }

  /** Register a listener for NPC needs updates (used for client broadcasting). */
  onNeedsUpdate(
    listener: (npcId: string, needs: SurvivalSnapshot) => void,
  ): void {
    this.needsListeners.push(listener);
  }

  /** Register a listener for player survival updates (used for sidebar status). */
  onPlayerSurvivalUpdate(
    listener: (playerId: string, needs: SurvivalSnapshot) => void,
  ): void {
    this.playerSurvivalListeners.push(listener);
  }

  onDebugStateUpdate(listener: (state: NpcAutonomyDebugState) => void): void {
    this.debugStateListeners.push(listener);
  }

  onDebugEvent(listener: (event: DebugFeedEventPayload) => void): void {
    this.debugEventListeners.push(listener);
  }

  /** Get the shared survival values for any spawned player. */
  getPlayerSurvival(playerId: string): SurvivalSnapshot | undefined {
    const player = this.game.getPlayer(playerId);
    if (!player) return undefined;
    if (player.isNpc) {
      return this.buildNpcSurvivalSnapshot(
        playerId,
        this.getState(playerId),
        player,
      );
    }

    return this.getOrCreateHumanSurvival(playerId, player);
  }

  /** Get need configs for an NPC (per-character or default). */
  private getNeedConfigs(npcId: string): Record<NeedType, NeedConfig> {
    return this.perNpcConfigs.get(npcId) ?? this.needConfigs;
  }

  private broadcastNeeds(npcId: string, state: NpcAutonomyState): void {
    const snapshot = this.buildNpcSurvivalSnapshot(npcId, state);
    for (const listener of this.needsListeners) {
      listener(npcId, snapshot);
    }
  }

  private broadcastPlayerSurvival(
    playerId: string,
    needs: SurvivalSnapshot,
  ): void {
    for (const listener of this.playerSurvivalListeners) {
      listener(playerId, { ...needs });
    }
  }

  private processHumanSurvivalTick(
    players: Array<{ id: string; x: number; y: number; isNpc: boolean }>,
    shouldBroadcast: boolean,
  ): void {
    for (const player of players) {
      if (player.isNpc) continue;
      const needs = this.getOrCreateHumanSurvival(player.id);
      tickNeeds(needs, this.needConfigs);
      this.replenishWaterAtPond(player, needs);
      if (this.maybeKillForDepletedSurvival(player.id, needs)) {
        continue;
      }
      if (shouldBroadcast) {
        this.broadcastPlayerSurvival(player.id, needs);
      }
    }
  }

  private processAutonomyTick(_result: TickResult): void {
    const players = this.game.getPlayers();
    const npcs = players.filter((p) => p.isNpc);
    const shouldBroadcastPlayerSurvival =
      this.game.currentTick % PLAYER_SURVIVAL_BROADCAST_INTERVAL === 0;
    const shouldBroadcastNpcNeeds =
      this.game.currentTick % NPC_NEEDS_BROADCAST_INTERVAL === 0;

    this.processHumanSurvivalTick(players, shouldBroadcastPlayerSurvival);

    for (const npc of npcs) {
      this.processNpcAutonomyTick(npc, shouldBroadcastNpcNeeds);
    }
  }

  private processNpcAutonomyTick(
    npc: AutonomyRuntimePlayer,
    shouldBroadcast: boolean,
  ): void {
    const state = this.getState(npc.id);
    const npcConfigs = this.getNeedConfigs(npc.id);
    this.observeEnvironment(npc, state);

    if (this.handleConversingNpc(npc, state, npcConfigs, shouldBroadcast)) {
      return;
    }

    const needsResult = tickNeeds(state.needs, npcConfigs);
    this.replenishWaterAtPond(npc, state.needs);
    if (this.maybeKillNpcForDepletedSurvival(npc, state)) {
      return;
    }

    if (needsResult.newCritical.length > 0 && state.currentPlan) {
      this.interruptPlan(
        npc.id,
        state,
        `Critical need: ${needsResult.newCritical.join(", ")}`,
        "because of a critical need",
      );
    }

    if (this.handleEmergencyFlee(npc, state, shouldBroadcast)) {
      return;
    }

    if (this.isNpcIdleCoolingDown(npc.id, state, shouldBroadcast)) {
      return;
    }

    if (!state.currentPlan) {
      this.tryPlan(npc.id, state);
    }

    if (state.currentPlan) {
      this.executeCurrentPlanStep(npc.id, state);
    }

    this.flushNpcOutputs(npc.id, state, npc, shouldBroadcast);
  }

  private handleConversingNpc(
    npc: AutonomyRuntimePlayer,
    state: NpcAutonomyState,
    npcConfigs: Record<NeedType, NeedConfig>,
    shouldBroadcast: boolean,
  ): boolean {
    if (npc.state !== "conversing") {
      return false;
    }

    const clearedPlan = this.buildCurrentDebugPlan(state);
    const clearedGoalId = clearedPlan?.goalId;
    this.clearPlanForConversation(state);
    if (clearedGoalId) {
      this.emitNpcGoalEvent(npc.id, {
        type: "plan_cleared",
        severity: "info",
        title: "Plan cleared",
        verb: "handed control to an active conversation and cleared",
        goalId: clearedGoalId,
        plan: clearedPlan,
      });
    }

    tickNeeds(state.needs, npcConfigs);
    this.replenishWaterAtPond(npc, state.needs);
    if (this.maybeKillNpcForDepletedSurvival(npc, state)) {
      return true;
    }

    this.flushNpcOutputs(npc.id, state, npc, shouldBroadcast);
    return true;
  }

  private maybeKillNpcForDepletedSurvival(
    npc: AutonomyRuntimePlayer,
    state: NpcAutonomyState,
  ): boolean {
    return this.maybeKillForDepletedSurvival(
      npc.id,
      this.buildNpcSurvivalSnapshot(npc.id, state, npc),
    );
  }

  private interruptPlan(
    npcId: string,
    state: NpcAutonomyState,
    reason: string,
    messageSuffix: string,
  ): void {
    if (!state.currentPlan) {
      return;
    }

    const interruptedPlan = this.buildCurrentDebugPlan(state);
    const interruptedGoalId =
      interruptedPlan?.goalId ?? state.currentPlan.goalId;

    invalidatePlan(
      npcId,
      state,
      this.registry,
      this.game,
      this.entityManager,
      reason,
    );
    this.emitNpcGoalEvent(npcId, {
      type: "plan_cleared",
      severity: "warning",
      title: "Plan interrupted",
      verb: "interrupted",
      goalId: interruptedGoalId,
      messageSuffix,
      plan: interruptedPlan ?? undefined,
    });
  }

  private handleEmergencyFlee(
    npc: AutonomyRuntimePlayer,
    state: NpcAutonomyState,
    shouldBroadcast: boolean,
  ): boolean {
    if (
      !this.hasAggressiveBearNearby(npc) ||
      state.currentPlan?.goalId === "escape_danger" ||
      state.currentExecution?.actionId === "attack_bear"
    ) {
      return false;
    }

    if (state.currentPlan) {
      this.interruptPlan(npc.id, state, "Emergency flee", "to flee danger");
    }

    this.idleCooldowns.delete(npc.id);
    const fleeGoal: WorldState = new Map([["escaped_hostile", true]]);
    this.executePlan(npc.id, state, fleeGoal, "escape_danger", {
      source: "emergency",
    });
    if (state.currentPlan) {
      const result = executeAutonomyTick(
        npc.id,
        state,
        this.registry,
        this.game,
        this.entityManager,
      );
      this.emitActionTransitions(npc.id, result.transitions);
      if (result.planCompleted) {
        state.consecutivePlanFailures = 0;
      }
    }

    this.flushNpcOutputs(npc.id, state, npc, shouldBroadcast);
    return true;
  }

  private isNpcIdleCoolingDown(
    npcId: string,
    state: NpcAutonomyState,
    shouldBroadcast: boolean,
  ): boolean {
    const cooldownExpiry = this.idleCooldowns.get(npcId);
    if (!cooldownExpiry || this.game.currentTick >= cooldownExpiry) {
      this.idleCooldowns.delete(npcId);
      return false;
    }

    if (shouldBroadcast) {
      this.broadcastNeeds(npcId, state);
    }
    this.publishDebugStateIfChanged(npcId, state);
    return true;
  }

  private executeCurrentPlanStep(npcId: string, state: NpcAutonomyState): void {
    if (!state.currentPlan) {
      return;
    }

    const planBeforeExecution = this.buildDebugPlan(
      state.currentPlan,
      state.currentPlanSource,
      state.currentPlanReasoning,
      state.currentStepIndex,
    );
    const result = executeAutonomyTick(
      npcId,
      state,
      this.registry,
      this.game,
      this.entityManager,
    );
    this.rememberActionTransitions(npcId, state, result.transitions);
    this.emitActionTransitions(npcId, result.transitions);

    if (result.planFailed) {
      state.consecutivePlanFailures++;
      if (!this.hasActionFailureMemory(result.transitions)) {
        this.rememberActionFailure(
          npcId,
          state,
          planBeforeExecution,
          result.failReason,
        );
      }
      this.emitNpcGoalEvent(npcId, {
        type: "plan_failed",
        severity: "warning",
        title: "Plan failed",
        verb: "failed",
        goalId: planBeforeExecution.goalId,
        detail: result.failReason,
        plan: planBeforeExecution,
      });
      if (state.consecutivePlanFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.idleCooldowns.set(
          npcId,
          this.game.currentTick + EXTENDED_IDLE_WAIT,
        );
        state.consecutivePlanFailures = 0;
      }
      return;
    }

    if (result.planCompleted) {
      state.consecutivePlanFailures = 0;
      this.emitNpcGoalEvent(npcId, {
        type: "plan_cleared",
        severity: "info",
        title: "Plan completed",
        verb: "completed",
        goalId: planBeforeExecution.goalId,
        plan: planBeforeExecution,
      });
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

    const socialPressure = this.socialInvitePressure(
      inviterId,
      inviteeId,
      state,
      configs,
    );

    if (currentNeed === null) {
      if (socialPressure >= 0.75) {
        return "accept";
      }
      return this.pendingInviteDecision(conversation);
    }

    const currentPressure = this.needPressure(
      currentNeed,
      state.needs[currentNeed],
      configs,
    );

    if (socialPressure + 0.1 >= currentPressure) {
      return "accept";
    }

    return this.pendingInviteDecision(conversation);
  }

  private needTypeForGoal(goalId: string | undefined): NeedType | null {
    switch (goalId) {
      case "satisfy_food":
        return "food";
      case "satisfy_water":
        return "water";
      case "satisfy_social":
        return "social";
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

    const distance = manhattanDistance(inviter, invitee);
    if (distance <= 2) return 0.4;
    if (distance <= 6) return 0.15;
    return 0;
  }

  private inviteTimedOut(conversation: Conversation): boolean {
    return (
      this.game.currentTick - conversation.startedTick >=
      INVITE_DECISION_TIMEOUT
    );
  }

  private pendingInviteDecision(conversation: Conversation): NpcInviteDecision {
    return this.inviteTimedOut(conversation) ? "decline" : "wait";
  }

  private socialInvitePressure(
    inviterId: string,
    inviteeId: string,
    state: NpcAutonomyState,
    configs: Record<NeedType, NeedConfig>,
  ): number {
    const inviter = this.game.getPlayer(inviterId);
    const invitee = this.game.getPlayer(inviteeId);
    return (
      this.needPressure("social", state.needs.social, configs) +
      this.inviteDistanceBoost(inviter, invitee)
    );
  }

  private tryPlan(npcId: string, state: NpcAutonomyState): void {
    const tick = this.game.currentTick;

    // Throttle goal selection
    if (tick - state.lastGoalSelectionTick < GOAL_SELECTION_COOLDOWN) {
      this.queueIdlePlan(npcId, state);
      return;
    }

    // Check if any needs are urgent
    const npcConfigs = this.getNeedConfigs(npcId);
    const urgent = getUrgentNeeds(state.needs, npcConfigs);
    if (urgent.length === 0 && !hasCriticalNeed(state.needs, npcConfigs)) {
      this.queueIdlePlan(npcId, state);
      return;
    }

    state.lastGoalSelectionTick = tick;

    const goalResult = selectGoalScripted(state.needs, npcConfigs);
    if (!goalResult) {
      this.queueIdlePlan(npcId, state);
      return;
    }

    // Start executing the scripted goal immediately so the NPC isn't idle.
    // If an LLM provider is available, fire off an async goal selection that
    // may replace this plan once it resolves (see tryLlmGoalSelection).
    this.executePlan(npcId, state, goalResult.goalState, goalResult.goalId, {
      source: "scripted",
    });

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
    state.goalSelectionStartedAtTick = this.game.currentTick;
    this.publishDebugStateIfChanged(npcId, state);
    try {
      const npc = this.game.getPlayer(npcId);
      if (!npc) return;

      const nearbyEntities = this.buildGoalNearbyEntities(npcId, npc);
      const options = this.rankGoalOptionsForSelection(
        npc,
        state,
        nearbyEntities,
        buildGoalOptions(state.needs, this.getNeedConfigs(npcId)),
      );
      const rememberedTargets = this.buildGoalRememberedTargets(
        npc,
        state,
        options,
      );
      const recentMemories = await this.retrievePlanningMemories(
        npcId,
        this.buildNpcSurvivalSnapshot(npcId, state, npc),
        Object.fromEntries(state.inventory),
        nearbyEntities,
        rememberedTargets,
        options,
      );

      const response = await this.provider.generateGoalSelection({
        npc,
        needs: this.buildNpcSurvivalSnapshot(npcId, state, npc),
        inventory: Object.fromEntries(state.inventory),
        nearbyEntities,
        rememberedTargets,
        recentMemories,
        availableGoals: options,
        currentTick: this.game.currentTick,
      });

      if (!response?.goalId) return;

      // Race condition guard: if the plan was replaced after we fired this
      // request (e.g. by an emergency flee or a new critical-need interrupt),
      // the newer plan takes priority — don't clobber it.
      const planIsStale =
        state.lastGoalSelectionTick !== requestTick ||
        (state.currentPlan && state.currentPlan.createdAtTick > requestTick);

      if (planIsStale) return;

      this.storeGoalReasoningMemory(npcId, response.goalId, response.reasoning);
      this.executeGoalSelectionPlan(
        npcId,
        state,
        response.goalId,
        options,
        response.reasoning,
      );
    } catch (error) {
      console.warn(`LLM goal selection failed for ${npcId}:`, error);
    } finally {
      this.goalSelectionInFlight.delete(npcId);
      state.goalSelectionStartedAtTick = null;
      this.publishDebugStateIfChanged(npcId, state);
    }
  }

  private executePlan(
    npcId: string,
    state: NpcAutonomyState,
    goalState: WorldState,
    goalId: string,
    provenance: {
      source: PlanSource;
      reasoning?: string;
      allowIdleFallback?: boolean;
    },
  ): boolean {
    const npc = this.game.getPlayer(npcId);
    if (!npc) return false;

    const currentState = snapshotWorldState(
      npcId,
      this.game,
      state.needs,
      state.inventory,
      this.entityManager,
      this.getNeedConfigs(npcId),
    );

    const result = plan(currentState, goalState, this.registry, {
      npcId,
      currentTick: this.game.currentTick,
      currentState,
      world: this.game.world,
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
      recentActionHistory: state.recentActionHistory,
      rememberedTargets: state.rememberedTargets,
    });

    if (result) {
      result.createdAtTick = this.game.currentTick;
      result.goalId = goalId;
      state.currentPlan = result;
      state.currentPlanSource = provenance.source;
      state.currentPlanReasoning = provenance.reasoning ?? null;
      state.currentStepIndex = 0;
      state.currentExecution = null;
      state.lastPlanTick = this.game.currentTick;
      this.emitNpcGoalEvent(npcId, {
        type: "plan_started",
        severity: "info",
        title: "Plan started",
        verb: "started",
        goalId,
        messageSuffix: `via ${provenance.source}`,
        plan: this.buildCurrentDebugPlan(state) ?? undefined,
      });
      this.publishDebugStateIfChanged(npcId, state);
      return true;
    }

    state.currentPlanSource = null;
    state.currentPlanReasoning = null;
    if ((provenance.allowIdleFallback ?? true) && goalId !== "idle_wander") {
      this.queueIdlePlan(npcId, state);
    }
    this.publishDebugStateIfChanged(npcId, state);
    return false;
  }

  private executeGoalSelectionPlan(
    npcId: string,
    state: NpcAutonomyState,
    selectedGoalId: string,
    options: GoalOption[],
    reasoning: string | undefined,
  ): { goalId: string; reasoning?: string } | null {
    const candidateGoalIds = [
      selectedGoalId,
      ...options
        .map((option) => option.id)
        .filter((goalId) => goalId !== selectedGoalId),
    ];

    for (const goalId of candidateGoalIds) {
      const goalState = goalIdToState(goalId);
      if (!goalState) {
        continue;
      }

      const goalReasoning =
        goalId === selectedGoalId
          ? reasoning
          : `${reasoning ? `${reasoning}. ` : ""}Fallback from ${selectedGoalId} because it was not plannable.`;
      const planned = this.executePlan(npcId, state, goalState, goalId, {
        source: "llm",
        reasoning: goalReasoning,
        allowIdleFallback: false,
      });
      if (planned) {
        return { goalId, reasoning: goalReasoning };
      }
    }

    this.queueIdlePlan(npcId, state);
    return null;
  }

  private storeGoalReasoningMemory(
    npcId: string,
    goalId: string,
    reasoning: string | undefined,
  ): void {
    if (!reasoning || !this.memoryManager) {
      return;
    }

    const goalDescription = goalId.startsWith("satisfy_")
      ? `address my ${goalId.slice("satisfy_".length)}`
      : goalId.replaceAll("_", " ");

    this.memoryManager
      .addMemory({
        playerId: npcId,
        type: "observation",
        content: `I decided to ${goalDescription}: ${reasoning}`,
        importance: 3,
        tick: this.game.currentTick,
      })
      .catch((err) => {
        console.warn(`Failed to store goal reasoning for ${npcId}:`, err);
      });
  }

  private buildDebugState(
    npcId: string,
    state: NpcAutonomyState,
  ): NpcAutonomyDebugState {
    const player = this.game.getPlayer(npcId);
    const currentPlan = this.buildCurrentDebugPlan(state);

    return {
      npcId,
      name: player?.name ?? npcId,
      lastPosition: player ? { x: player.x, y: player.y } : undefined,
      lastState: player?.state,
      isDead: false,
      needs: this.buildNpcSurvivalSnapshot(npcId, state, player),
      inventory: Object.fromEntries(state.inventory),
      currentPlan,
      currentStepIndex: state.currentStepIndex,
      currentExecution: this.buildDebugExecution(state),
      consecutivePlanFailures: state.consecutivePlanFailures,
      goalSelectionInFlight: this.goalSelectionInFlight.has(npcId),
      goalSelectionStartedAtTick: state.goalSelectionStartedAtTick,
    };
  }

  private publishDebugStateIfChanged(
    npcId: string,
    state: NpcAutonomyState,
  ): void {
    this.publishDebugSnapshot(this.buildDebugState(npcId, state));
  }

  private flushNpcOutputs(
    npcId: string,
    state: NpcAutonomyState,
    player: { hp?: number; maxHp?: number } | undefined,
    shouldBroadcast: boolean,
  ): void {
    if (shouldBroadcast) {
      this.broadcastNpcSurvival(npcId, state, player);
    }
    this.publishDebugStateIfChanged(npcId, state);
  }

  private broadcastNpcSurvival(
    npcId: string,
    state: NpcAutonomyState,
    player: { hp?: number; maxHp?: number } | undefined,
  ): void {
    this.broadcastNeeds(npcId, state);
    this.broadcastPlayerSurvival(
      npcId,
      this.buildNpcSurvivalSnapshot(npcId, state, player),
    );
  }

  private publishDebugSnapshot(debugState: NpcAutonomyDebugState): void {
    const serialized = JSON.stringify(debugState);
    if (this.debugStateHashes.get(debugState.npcId) === serialized) {
      return;
    }

    this.debugStateHashes.set(debugState.npcId, serialized);
    for (const listener of this.debugStateListeners) {
      listener(debugState);
    }
  }

  private emitDebugEvent(event: DebugFeedEventPayload): void {
    for (const listener of this.debugEventListeners) {
      listener(event);
    }
  }

  private emitActionTransitions(
    npcId: string,
    transitions: ReadonlyArray<{
      type: "action_started" | "action_completed" | "action_failed";
      actionId: string;
      stepIndex: number;
      reason?: string;
    }>,
  ): void {
    for (const transition of transitions) {
      const actionLabel =
        this.registry.get(transition.actionId)?.displayName ??
        transition.actionId;

      if (transition.type === "action_started") {
        this.emitNpcActionEvent(npcId, {
          type: "action_started",
          severity: "info",
          title: "Action started",
          verb: "started",
          actionLabel,
        });
        continue;
      }

      if (transition.type === "action_completed") {
        this.emitNpcActionEvent(npcId, {
          type: "action_completed",
          severity: "info",
          title: "Action completed",
          verb: "completed",
          actionLabel,
        });
        continue;
      }

      this.emitNpcActionEvent(npcId, {
        type: "action_failed",
        severity: "warning",
        title: "Action failed",
        verb: "failed",
        actionLabel,
        detail: transition.reason,
      });
    }
  }

  private rememberActionTransitions(
    npcId: string,
    state: NpcAutonomyState,
    transitions: ReadonlyArray<{
      actionId: string;
      type: "action_started" | "action_completed" | "action_failed";
      reason?: string;
      memory?: {
        content: string;
        importance: number;
        hint?: {
          outcomeTag?:
            | "resource_found"
            | "resource_depleted"
            | "social_success"
            | "social_unavailable"
            | "danger";
          targetType?: string;
          targetId?: string;
          targetPosition?: Position;
        };
      };
    }>,
  ): void {
    for (const transition of transitions) {
      if (
        transition.type !== "action_completed" &&
        transition.type !== "action_failed"
      ) {
        continue;
      }

      this.appendActionHistoryEntry(state, {
        actionId: transition.actionId,
        outcome:
          transition.type === "action_completed" ? "completed" : "failed",
        tick: this.game.currentTick,
        reason: transition.reason,
        outcomeTag: transition.memory?.hint?.outcomeTag,
        targetType: transition.memory?.hint?.targetType,
        targetId: transition.memory?.hint?.targetId,
        targetPosition: transition.memory?.hint?.targetPosition,
      });
      if (
        transition.memory?.hint?.targetType &&
        transition.memory.hint.targetPosition
      ) {
        this.upsertRememberedTarget(state, {
          targetType: transition.memory.hint.targetType,
          targetId: transition.memory.hint.targetId,
          position: transition.memory.hint.targetPosition,
          lastSeenTick: this.game.currentTick,
          source: "action",
          availability: this.availabilityFromOutcomeTag(
            transition.memory.hint.outcomeTag,
          ),
        });
      }

      if (!this.memoryManager || !transition.memory) {
        continue;
      }

      this.memoryManager
        .addMemory({
          playerId: npcId,
          type: "observation",
          content: transition.memory.content,
          importance: transition.memory.importance,
          tick: this.game.currentTick,
        })
        .catch((error) => {
          console.warn(`Failed to store action memory for ${npcId}:`, error);
        });
    }
  }

  private appendActionHistoryEntry(
    state: NpcAutonomyState,
    entry: ActionHistoryEntry,
  ): void {
    state.recentActionHistory.push(entry);
    if (state.recentActionHistory.length > ACTION_HISTORY_LIMIT) {
      state.recentActionHistory.splice(
        0,
        state.recentActionHistory.length - ACTION_HISTORY_LIMIT,
      );
    }
  }

  private observeEnvironment(
    npc: AutonomyRuntimePlayer,
    state: NpcAutonomyState,
  ): void {
    const pos = { x: Math.round(npc.x), y: Math.round(npc.y) };
    this.pruneRememberedTargets(state);

    for (const entity of this.entityManager.getNearby(
      pos,
      OBSERVATION_RADIUS,
    )) {
      const target = this.toRememberedTargetFromEntity(entity);
      if (!target) {
        continue;
      }
      this.upsertRememberedTarget(state, target);

      const notable = this.describeNotableObservation(entity);
      if (notable) {
        this.rememberObservation(
          npc.id,
          state,
          notable.key,
          notable.content,
          notable.importance,
        );
      }
    }

    for (const player of this.game.getPlayers()) {
      if (player.id === npc.id) {
        continue;
      }
      const distance = manhattanDistance(pos, player);
      if (distance > OBSERVATION_RADIUS) {
        continue;
      }
      this.upsertRememberedTarget(state, {
        targetType: "player",
        targetId: player.id,
        position: { x: Math.round(player.x), y: Math.round(player.y) },
        lastSeenTick: this.game.currentTick,
        source: "observation",
        availability:
          player.state === "conversing" ? "unavailable" : "available",
      });
    }
  }

  private toRememberedTargetFromEntity(entity: {
    id: string;
    type: string;
    position: Position;
    destroyed: boolean;
    properties: Record<string, unknown>;
  }): RememberedTarget | null {
    if (entity.destroyed) {
      return null;
    }

    switch (entity.type) {
      case "berry_bush":
        return {
          targetType: entity.type,
          targetId: entity.id,
          position: entity.position,
          lastSeenTick: this.game.currentTick,
          source: "observation",
          availability:
            ((entity.properties.berries as number | undefined) ?? 0) > 0
              ? "available"
              : "depleted",
        };
      case "water_source":
      case "campfire":
      case "ground_item":
      case "bear_meat":
        return {
          targetType: entity.type,
          targetId: entity.id,
          position: entity.position,
          lastSeenTick: this.game.currentTick,
          source: "observation",
          availability: "available",
        };
      case "bear":
        if (entity.properties.state === "dead") {
          return null;
        }
        return {
          targetType: entity.type,
          targetId: entity.id,
          position: entity.position,
          lastSeenTick: this.game.currentTick,
          source: "observation",
          availability: "danger",
        };
      default:
        return null;
    }
  }

  private describeNotableObservation(entity: {
    id: string;
    type: string;
    position: Position;
    properties: Record<string, unknown>;
  }): { key: string; content: string; importance: number } | null {
    switch (entity.type) {
      case "berry_bush":
        if (((entity.properties.berries as number | undefined) ?? 0) > 0) {
          return {
            key: `observed:${entity.id}:berries`,
            content: `I noticed a berry bush with fruit at (${entity.position.x}, ${entity.position.y}).`,
            importance: 2,
          };
        }
        return {
          key: `observed:${entity.id}:depleted`,
          content: `I found a berry bush at (${entity.position.x}, ${entity.position.y}), but it had no berries left.`,
          importance: 3,
        };
      case "water_source":
        return {
          key: `observed:${entity.id}:water`,
          content: `I spotted water at (${entity.position.x}, ${entity.position.y}).`,
          importance: 2,
        };
      case "campfire":
        if (entity.properties.lit === true) {
          return {
            key: `observed:${entity.id}:campfire`,
            content: `I saw a lit campfire at (${entity.position.x}, ${entity.position.y}).`,
            importance: 2,
          };
        }
        return null;
      case "bear":
        if (entity.properties.state !== "dead") {
          return {
            key: `observed:${entity.id}:bear`,
            content: `I saw a bear near (${entity.position.x}, ${entity.position.y}).`,
            importance: 6,
          };
        }
        return null;
      default:
        return null;
    }
  }

  private rememberObservation(
    npcId: string,
    state: NpcAutonomyState,
    key: string,
    content: string,
    importance: number,
  ): void {
    const lastObservedTick =
      state.lastObservationTickByKey.get(key) ?? Number.NEGATIVE_INFINITY;
    if (
      this.game.currentTick - lastObservedTick <
      OBSERVATION_MEMORY_COOLDOWN
    ) {
      return;
    }
    state.lastObservationTickByKey.set(key, this.game.currentTick);

    if (!this.memoryManager) {
      return;
    }

    this.memoryManager
      .addMemory({
        playerId: npcId,
        type: "observation",
        content,
        importance,
        tick: this.game.currentTick,
      })
      .catch((error) => {
        console.warn(`Failed to store observation memory for ${npcId}:`, error);
      });
  }

  private upsertRememberedTarget(
    state: NpcAutonomyState,
    target: RememberedTarget,
  ): void {
    const key = this.rememberedTargetKey(target);
    const index = state.rememberedTargets.findIndex(
      (candidate) => this.rememberedTargetKey(candidate) === key,
    );
    if (index >= 0) {
      state.rememberedTargets[index] = {
        ...state.rememberedTargets[index],
        ...target,
      };
    } else {
      state.rememberedTargets.push({ ...target });
    }

    state.rememberedTargets.sort(
      (left, right) => right.lastSeenTick - left.lastSeenTick,
    );
    if (state.rememberedTargets.length > REMEMBERED_TARGET_LIMIT) {
      state.rememberedTargets.length = REMEMBERED_TARGET_LIMIT;
    }
  }

  private pruneRememberedTargets(state: NpcAutonomyState): void {
    const cutoff = this.game.currentTick - REMEMBERED_TARGET_TTL;
    state.rememberedTargets = state.rememberedTargets.filter(
      (target) => target.lastSeenTick >= cutoff,
    );
  }

  private rememberedTargetKey(target: RememberedTarget): string {
    if (target.targetId) {
      return `${target.targetType}:${target.targetId}`;
    }
    return `${target.targetType}:${target.position.x}:${target.position.y}`;
  }

  private availabilityFromOutcomeTag(
    outcomeTag:
      | "resource_found"
      | "resource_depleted"
      | "social_success"
      | "social_unavailable"
      | "danger"
      | undefined,
  ): RememberedTarget["availability"] {
    switch (outcomeTag) {
      case "resource_found":
      case "social_success":
        return "available";
      case "resource_depleted":
      case "social_unavailable":
        return "unavailable";
      case "danger":
        return "danger";
      default:
        return undefined;
    }
  }

  private hasActionFailureMemory(
    transitions: ReadonlyArray<{
      type: "action_started" | "action_completed" | "action_failed";
      memory?: {
        content: string;
        importance: number;
      };
    }>,
  ): boolean {
    return transitions.some(
      (transition) =>
        transition.type === "action_failed" && transition.memory !== undefined,
    );
  }

  private rememberActionFailure(
    npcId: string,
    state: NpcAutonomyState,
    plan: NpcAutonomyDebugPlan,
    reason: string | undefined,
  ): void {
    const step = plan.steps.find((candidate) => candidate.isCurrent);
    if (!step) {
      return;
    }

    this.appendActionHistoryEntry(state, {
      actionId: step.actionId,
      outcome: "failed",
      tick: this.game.currentTick,
      reason,
    });

    if (!this.memoryManager) {
      return;
    }

    this.memoryManager
      .addMemory({
        playerId: npcId,
        type: "observation",
        content: `I tried to ${step.actionLabel.toLowerCase()} but failed: ${reason ?? "something went wrong"}.`,
        importance: 4,
        tick: this.game.currentTick,
      })
      .catch((error) => {
        console.warn(
          `Failed to store failed action memory for ${npcId}:`,
          error,
        );
      });
  }

  private async retrievePlanningMemories(
    npcId: string,
    needs: SurvivalSnapshot,
    inventory: Record<string, number>,
    nearbyEntities: Array<{ type: string; distance: number; name?: string }>,
    rememberedTargets: NpcGoalRememberedTarget[],
    options: GoalOption[],
  ): Promise<Memory[]> {
    if (!this.memoryManager) {
      return [];
    }

    const query = this.buildPlanningMemoryQuery(
      needs,
      inventory,
      nearbyEntities,
      rememberedTargets,
      options,
    );

    try {
      if (!query.trim()) {
        return this.memoryManager.getMemories(npcId, {
          limit: PLANNING_MEMORY_LIMIT,
        });
      }

      const scored = await this.memoryManager.retrieveMemories({
        playerId: npcId,
        query,
        currentTick: this.game.currentTick,
        k: PLANNING_MEMORY_LIMIT,
      });
      return scored.map((memory) => memory);
    } catch (error) {
      console.warn(`Failed to retrieve planning memories for ${npcId}:`, error);
      return [];
    }
  }

  private buildPlanningMemoryQuery(
    needs: SurvivalSnapshot,
    inventory: Record<string, number>,
    nearbyEntities: Array<{ type: string; distance: number; name?: string }>,
    rememberedTargets: NpcGoalRememberedTarget[],
    options: GoalOption[],
  ): string {
    const urgentNeeds = Object.entries(needs)
      .filter(([need, value]) => need !== "health" && value < 45)
      .sort((left, right) => left[1] - right[1])
      .map(([need]) => need);

    const inventoryItems = Object.entries(inventory)
      .filter(([, count]) => count > 0)
      .map(([item, count]) => `${item} x${count}`);

    const nearbyTypes = nearbyEntities.map((entity) => entity.type);
    const rememberedTypes = rememberedTargets.map((target) => {
      const availability =
        target.availability !== undefined ? `:${target.availability}` : "";
      return `${target.type}${availability}`;
    });
    const goalIds = options.map((option) => option.id);

    return [
      urgentNeeds.length > 0
        ? `Urgent needs: ${urgentNeeds.join(", ")}.`
        : "No urgent needs.",
      inventoryItems.length > 0
        ? `Inventory: ${inventoryItems.join(", ")}.`
        : "Inventory is empty.",
      nearbyTypes.length > 0
        ? `Nearby: ${nearbyTypes.join(", ")}.`
        : "Nothing notable is nearby.",
      rememberedTypes.length > 0
        ? `Remembered targets: ${rememberedTypes.join(", ")}.`
        : "No useful remembered targets.",
      goalIds.length > 0
        ? `Possible goals: ${goalIds.join(", ")}.`
        : "No goals available.",
    ].join(" ");
  }

  private buildGoalNearbyEntities(
    npcId: string,
    npc: AutonomyRuntimePlayer,
  ): Array<{ type: string; distance: number; name?: string }> {
    const pos = { x: Math.round(npc.x), y: Math.round(npc.y) };
    const nearbyEntities = this.entityManager
      .getNearby(pos, GOAL_SELECTION_OBSERVATION_RADIUS)
      .map((entity) => ({
        type: entity.type,
        distance: manhattanDistance(entity.position, npc),
        name: entity.id,
      }));
    const nearbyPlayers = this.game
      .getPlayers()
      .filter((player) => player.id !== npcId)
      .map((player) => ({
        type: "player",
        distance: manhattanDistance(player, npc),
        name: player.id,
      }))
      .filter((player) => player.distance <= GOAL_SELECTION_OBSERVATION_RADIUS);

    return [...nearbyEntities, ...nearbyPlayers]
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 5);
  }

  private rankGoalOptionsForSelection(
    npc: AutonomyRuntimePlayer,
    state: NpcAutonomyState,
    nearbyEntities: Array<{ type: string; distance: number; name?: string }>,
    options: GoalOption[],
  ): GoalOption[] {
    const rememberedTargets = state.rememberedTargets.map((target) => ({
      type: target.targetType,
      distance: manhattanDistance(target.position, npc),
      ageTicks: Math.max(0, this.game.currentTick - target.lastSeenTick),
      source: target.source,
      availability: target.availability,
      name: target.targetId,
    }));

    return options
      .map((option, index) => {
        const assessment = this.assessGoalOptionForSelection(
          option.id,
          state,
          nearbyEntities,
          rememberedTargets,
        );
        return {
          option: {
            ...option,
            description: this.describeGoalOptionForSelection(
              option.description,
              assessment,
            ),
          },
          score: assessment.score,
          index,
        };
      })
      .sort(
        (left, right) => right.score - left.score || left.index - right.index,
      )
      .map((entry) => entry.option);
  }

  private buildGoalRememberedTargets(
    npc: AutonomyRuntimePlayer,
    state: NpcAutonomyState,
    options: GoalOption[],
  ): NpcGoalRememberedTarget[] {
    const relevantTypes = this.goalRelevantTargetTypes(
      options,
      state.inventory,
    );
    const summaries = state.rememberedTargets.map((target) => ({
      type: target.targetType,
      distance: manhattanDistance(target.position, npc),
      ageTicks: Math.max(0, this.game.currentTick - target.lastSeenTick),
      source: target.source,
      availability: target.availability,
      name: target.targetId,
    }));

    const relevantSummaries = summaries.filter((target) =>
      relevantTypes.has(target.type),
    );
    const candidates =
      relevantSummaries.length > 0 ? relevantSummaries : summaries;

    return candidates
      .sort(
        (left, right) =>
          this.goalRememberedTargetScore(right, relevantTypes) -
            this.goalRememberedTargetScore(left, relevantTypes) ||
          left.ageTicks - right.ageTicks ||
          left.distance - right.distance,
      )
      .slice(0, GOAL_REMEMBERED_TARGET_LIMIT);
  }

  private assessGoalOptionForSelection(
    goalId: string,
    state: NpcAutonomyState,
    nearbyEntities: Array<{ type: string; distance: number; name?: string }>,
    rememberedTargets: NpcGoalRememberedTarget[],
  ): {
    score: number;
    inventoryHint?: string;
    nearbyHint?: { type: string; distance: number };
    rememberedHint?: NpcGoalRememberedTarget;
  } {
    const relevantTypes = this.goalRelevantTargetTypesForGoal(
      goalId,
      state.inventory,
    );
    let score = 100 - this.goalNeedValue(goalId, state.needs);
    let inventoryHint: string | undefined;

    if (goalId === "satisfy_food") {
      if ((state.inventory.get("cooked_food") ?? 0) > 0) {
        score += 50;
        inventoryHint = "You already have cooked food in your inventory.";
      } else if (
        (state.inventory.get("raw_food") ?? 0) > 0 ||
        (state.inventory.get("bear_meat") ?? 0) > 0
      ) {
        score += 40;
        inventoryHint = "You already have edible food in your inventory.";
      }
    }

    const nearbyHint = nearbyEntities
      .filter((entity) => relevantTypes.includes(entity.type))
      .sort((left, right) => left.distance - right.distance)[0];
    if (nearbyHint) {
      score += 35 - nearbyHint.distance * 2;
    }

    const rememberedHint = rememberedTargets
      .filter((target) => relevantTypes.includes(target.type))
      .sort((left, right) => {
        const leftScore = this.goalSelectionRememberedTargetScore(left);
        const rightScore = this.goalSelectionRememberedTargetScore(right);
        return rightScore - leftScore;
      })[0];
    if (rememberedHint) {
      score += this.goalSelectionRememberedTargetScore(rememberedHint);
    }

    return { score, inventoryHint, nearbyHint, rememberedHint };
  }

  private goalRelevantTargetTypes(
    options: GoalOption[],
    inventory: NpcAutonomyState["inventory"],
  ): Map<string, number> {
    const relevantTypes = new Map<string, number>();
    const register = (type: string, priority: number): void => {
      const current = relevantTypes.get(type);
      if (current === undefined || priority < current) {
        relevantTypes.set(type, priority);
      }
    };

    for (const [priority, option] of options.entries()) {
      for (const type of this.goalRelevantTargetTypesForGoal(
        option.id,
        inventory,
      )) {
        register(type, priority);
      }
    }

    return relevantTypes;
  }

  private goalRelevantTargetTypesForGoal(
    goalId: string,
    inventory: NpcAutonomyState["inventory"],
  ): string[] {
    switch (goalId) {
      case "satisfy_food":
        return [
          "berry_bush",
          "ground_item",
          "bear_meat",
          "bear",
          ...((inventory.get("raw_food") ?? 0) > 0 ? ["campfire"] : []),
        ];
      case "satisfy_water":
        return ["water_source"];
      case "satisfy_social":
        return ["player"];
      default:
        return [];
    }
  }

  private goalNeedValue(goalId: string, needs: NpcNeeds): number {
    switch (goalId) {
      case "satisfy_food":
        return needs.food;
      case "satisfy_water":
        return needs.water;
      case "satisfy_social":
        return needs.social;
      default:
        return 50;
    }
  }

  private goalRememberedTargetScore(
    target: NpcGoalRememberedTarget,
    relevantTypes: Map<string, number>,
  ): number {
    let score = 0;

    const priority = relevantTypes.get(target.type);
    if (priority !== undefined) {
      score += 100 - priority * 25;
    }

    switch (target.availability) {
      case "available":
        score += 20;
        break;
      case "danger":
        score += target.type === "bear" ? 8 : -10;
        break;
      case "depleted":
      case "unavailable":
        score -= 25;
        break;
    }

    if (target.source === "observation") {
      score += 3;
    }

    score -= target.distance * 1.5;
    score -= target.ageTicks / 40;
    return score;
  }

  private goalSelectionRememberedTargetScore(
    target: NpcGoalRememberedTarget,
  ): number {
    let score = 0;

    switch (target.availability) {
      case "available":
        score += 20;
        break;
      case "danger":
        score += target.type === "bear" ? 8 : -10;
        break;
      case "depleted":
      case "unavailable":
        score -= 25;
        break;
    }

    if (target.source === "observation") {
      score += 3;
    }

    score -= target.distance * 1.5;
    score -= target.ageTicks / 50;
    return score;
  }

  private describeGoalOptionForSelection(
    description: string,
    assessment: {
      inventoryHint?: string;
      nearbyHint?: { type: string; distance: number };
      rememberedHint?: NpcGoalRememberedTarget;
    },
  ): string {
    if (assessment.inventoryHint) {
      return `${description}. ${assessment.inventoryHint}`;
    }
    if (assessment.nearbyHint) {
      return `${description}. You can already see ${assessment.nearbyHint.type} ${Math.round(assessment.nearbyHint.distance)} tiles away.`;
    }
    if (assessment.rememberedHint) {
      return `${description}. You remember ${assessment.rememberedHint.type} about ${Math.round(assessment.rememberedHint.distance)} tiles away from ${Math.round(assessment.rememberedHint.ageTicks)} ticks ago.`;
    }
    return description;
  }

  private emitNpcGoalEvent(
    npcId: string,
    params: {
      type: DebugFeedEventPayload["type"];
      severity: DebugFeedEventPayload["severity"];
      title: string;
      verb: string;
      goalId: string;
      messageSuffix?: string;
      detail?: string;
      plan?: NpcAutonomyDebugPlan;
    },
  ): void {
    this.emitDebugEvent(
      this.createNpcDebugEvent(npcId, {
        type: params.type,
        severity: params.severity,
        title: params.title,
        message: this.describeNpcOutcome(
          npcId,
          params.verb,
          this.formatGoal(params.goalId),
          params,
        ),
        plan: params.plan,
      }),
    );
  }

  private emitNpcActionEvent(
    npcId: string,
    params: {
      type: "action_started" | "action_completed" | "action_failed";
      severity: DebugFeedEventPayload["severity"];
      title: string;
      verb: string;
      actionLabel: string;
      detail?: string;
    },
  ): void {
    this.emitDebugEvent(
      this.createNpcDebugEvent(npcId, {
        type: params.type,
        severity: params.severity,
        title: params.title,
        message: this.describeNpcOutcome(
          npcId,
          params.verb,
          params.actionLabel,
          params,
        ),
      }),
    );
  }

  private describeNpcOutcome(
    npcId: string,
    verb: string,
    subject: string,
    params: {
      detail?: string;
      messageSuffix?: string;
    },
  ): string {
    const detail = params.detail ? `: ${params.detail}` : "";
    const suffix = params.messageSuffix ? ` ${params.messageSuffix}` : "";
    return `${this.getNpcLabel(npcId)} ${verb} ${subject}${detail}${suffix}.`;
  }

  private describeNpcSurvivalDeath(
    npcId: string,
    depletedNeed: SurvivalNeed,
  ): string {
    return `${this.getNpcLabel(npcId)} died because ${depletedNeed} reached 0.`;
  }

  private createNpcDebugEvent(
    npcId: string,
    params: Omit<
      DebugFeedEventPayload,
      "tick" | "subjectType" | "subjectId" | "relatedNpcId"
    >,
  ): DebugFeedEventPayload {
    return {
      tick: this.game.currentTick,
      subjectType: "npc",
      subjectId: npcId,
      relatedNpcId: npcId,
      ...params,
    };
  }

  private getNpcLabel(npcId: string): string {
    return this.game.getPlayer(npcId)?.name ?? npcId;
  }

  private formatGoal(goalId: string): string {
    return goalId.replaceAll("_", " ");
  }

  private buildCurrentDebugPlan(
    state: NpcAutonomyState,
  ): NpcAutonomyDebugPlan | null {
    if (!state.currentPlan) {
      return null;
    }

    return this.buildDebugPlan(
      state.currentPlan,
      state.currentPlanSource,
      state.currentPlanReasoning,
      state.currentStepIndex,
    );
  }

  private buildDebugPlan(
    plan: Plan,
    source: PlanSource | null,
    reasoning: string | null,
    currentStepIndex: number,
  ): NpcAutonomyDebugPlan {
    return {
      goalId: plan.goalId,
      totalCost: plan.totalCost,
      createdAtTick: plan.createdAtTick,
      source: source ?? "scripted",
      llmGenerated: source === "llm",
      reasoning: reasoning ?? undefined,
      steps: plan.steps.map((step, index) => ({
        index,
        actionId: step.actionId,
        actionLabel:
          this.registry.get(step.actionId)?.displayName ?? step.actionId,
        targetPosition: step.targetPosition,
        isCurrent: index === currentStepIndex,
      })),
    };
  }

  private buildDebugExecution(
    state: NpcAutonomyState,
  ): NpcAutonomyDebugState["currentExecution"] {
    if (!state.currentExecution) {
      return null;
    }

    return {
      actionId: state.currentExecution.actionId,
      actionLabel:
        this.registry.get(state.currentExecution.actionId)?.displayName ??
        state.currentExecution.actionId,
      startedAtTick: state.currentExecution.startedAtTick,
      status: state.currentExecution.status,
      stepIndex: state.currentStepIndex,
    };
  }

  private recordDeadNpcState(
    player: {
      id: string;
      name: string;
      x: number;
      y: number;
      state: string;
      hp?: number;
      maxHp?: number;
    },
    state: NpcAutonomyState,
    death: NpcAutonomyDebugDeath,
  ): void {
    const deadState: NpcAutonomyDebugState = {
      npcId: player.id,
      name: player.name,
      lastPosition: { x: player.x, y: player.y },
      lastState: player.state,
      isDead: true,
      death,
      needs: this.buildNpcSurvivalSnapshot(player.id, state, player),
      inventory: Object.fromEntries(state.inventory),
      currentPlan: this.buildCurrentDebugPlan(state),
      currentStepIndex: state.currentStepIndex,
      currentExecution: this.buildDebugExecution(state),
      consecutivePlanFailures: state.consecutivePlanFailures,
      goalSelectionInFlight: false,
      goalSelectionStartedAtTick: null,
    };

    this.deadDebugStates.set(player.id, deadState);
    this.publishDebugSnapshot(deadState);
    void this.npcStore?.recordDeadNpc(deadState).catch((error) => {
      console.error(
        `Failed to persist dead NPC snapshot for ${player.id}:`,
        error,
      );
    });
  }

  private queueIdlePlan(npcId: string, state: NpcAutonomyState): void {
    const npc = this.game.getPlayer(npcId);
    if (!npc) return;
    if (npc.state === "walking" || state.currentPlan) return;

    this.setIdleCooldown(npcId);
    const idleGoal: WorldState = new Map([["has_wandered_recently", true]]);
    this.executePlan(npcId, state, idleGoal, "idle_wander", {
      source: "scripted",
    });
  }

  private setIdleCooldown(npcId: string): void {
    const wait =
      IDLE_WAIT_MIN + this.game.rng.nextInt(IDLE_WAIT_MAX - IDLE_WAIT_MIN);
    this.idleCooldowns.set(npcId, this.game.currentTick + wait);
  }

  private clearPlanForConversation(state: NpcAutonomyState): void {
    if (!state.currentPlan && !state.currentExecution) {
      return;
    }

    state.currentPlan = null;
    state.currentPlanSource = null;
    state.currentPlanReasoning = null;
    state.currentStepIndex = 0;
    state.currentExecution = null;
    state.consecutivePlanFailures = 0;
    state.goalSelectionStartedAtTick = null;
  }

  private getOrCreateHumanSurvival(
    playerId: string,
    player = this.game.getPlayer(playerId),
  ): SurvivalSnapshot {
    let survival = this.playerSurvival.get(playerId);
    if (!survival) {
      survival = {
        health: 100,
        ...createDefaultNeeds(this.needConfigs),
      };
      this.playerSurvival.set(playerId, survival);
    }
    if (player) {
      survival.health = this.healthFromPlayer(player);
    }
    return survival;
  }

  private buildNpcSurvivalSnapshot(
    npcId: string,
    state: NpcAutonomyState,
    player: { hp?: number; maxHp?: number } | undefined = this.game.getPlayer(
      npcId,
    ),
  ): SurvivalSnapshot {
    return {
      health: player ? this.healthFromPlayer(player) : 100,
      food: state.needs.food,
      water: state.needs.water,
      social: state.needs.social,
    };
  }

  private healthFromPlayer(player: { hp?: number; maxHp?: number }): number {
    const maxHp = player.maxHp ?? DEFAULT_PLAYER_MAX_HP;
    const currentHp = player.hp ?? maxHp;
    return Math.max(0, Math.min(100, (currentHp / maxHp) * 100));
  }

  private depletedSurvivalNeed(
    survival: SurvivalSnapshot,
  ): SurvivalNeed | null {
    for (const need of ["health", "food", "water", "social"] as const) {
      if (survival[need] <= 0) {
        return need;
      }
    }
    return null;
  }

  private maybeKillForDepletedSurvival(
    playerId: string,
    survival: SurvivalSnapshot,
  ): boolean {
    const depletedNeed = this.depletedSurvivalNeed(survival);
    if (!depletedNeed) {
      return false;
    }

    const player = this.game.getPlayer(playerId);
    if (!player) {
      return false;
    }

    if (player.isNpc) {
      const state = this.states.get(playerId);
      const interruptedPlan = state ? this.buildCurrentDebugPlan(state) : null;
      const deathMessage = this.describeNpcSurvivalDeath(
        playerId,
        depletedNeed,
      );
      if (state) {
        this.recordDeadNpcState(player, state, {
          tick: this.game.currentTick,
          reason: "death",
          cause: "survival",
          depletedNeed,
          message: deathMessage,
        });
      }
      this.emitDebugEvent(
        this.createNpcDebugEvent(
          playerId,
          interruptedPlan
            ? {
                type: "plan_cleared",
                severity: "warning",
                title: "NPC died",
                message: deathMessage,
                plan: interruptedPlan,
              }
            : {
                type: "error",
                severity: "error",
                title: "NPC died",
                message: deathMessage,
              },
        ),
      );
    }

    this.game.emitEvent({
      tick: this.game.currentTick,
      type: "player_death",
      playerId,
      data: {
        cause: "survival",
        depletedNeed,
      },
    });
    this.game.removePlayer(playerId, {
      reason: "death",
      cause: "survival",
      depletedNeed,
    });
    return true;
  }

  private replenishWaterAtPond(
    player: { x: number; y: number },
    needs: NpcNeeds,
  ): void {
    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    const waterSources = this.entityManager.getNearby(pos, 1, "water_source");
    if (waterSources.length === 0) return;
    boostNeed(needs, "water", POND_WATER_RESTORE_PER_TICK);
  }

  private hasAggressiveBearNearby(player: { x: number; y: number }): boolean {
    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    const bears = this.entityManager.getNearby(
      pos,
      AGGRESSIVE_BEAR_RADIUS,
      "bear",
    );
    return bears.some(
      (bear) =>
        !bear.destroyed &&
        (bear.properties.state === "aggro" ||
          bear.properties.state === "attacking"),
    );
  }

  private boostPlayerNeed(
    playerId: string,
    need: NeedType,
    amount: number,
  ): void {
    const player = this.game.getPlayer(playerId);
    if (!player) return;

    if (player.isNpc) {
      const state = this.getState(playerId);
      boostNeed(state.needs, need, amount);
      this.broadcastNpcSurvival(playerId, state, player);
      return;
    }

    const survival = this.getOrCreateHumanSurvival(playerId, player);
    boostNeed(survival, need, amount);
    this.broadcastPlayerSurvival(playerId, survival);
  }

  private foodRestoreForItem(item: string): number {
    switch (item) {
      case "raw_food":
        return PLAYER_RAW_FOOD_RESTORE;
      case "cooked_food":
        return PLAYER_COOKED_FOOD_RESTORE;
      case "bear_meat":
        return PLAYER_BEAR_MEAT_FOOD_RESTORE;
      default:
        return 0;
    }
  }

  private broadcastCurrentSurvival(playerId: string): void {
    const player = this.game.getPlayer(playerId);
    if (!player) return;
    const snapshot = this.getPlayerSurvival(playerId);
    if (!snapshot) return;
    if (player.isNpc) {
      const state = this.getState(playerId);
      this.broadcastNpcSurvival(playerId, state, player);
      return;
    }
    this.broadcastPlayerSurvival(playerId, snapshot);
  }
}
