/**
 * Central game simulation loop.
 *
 * GameLoop owns all mutable gameplay state (players, conversations, events)
 * and advances the simulation one tick at a time. It supports two modes:
 *
 * - **stepped** — call `tick()` manually (used by tests and the debug API).
 * - **realtime** — auto-ticks at `tickRate` Hz via `setInterval`.
 *
 * ## Tick pipeline
 * 1. Drain command queue (spawn, move, say, …)
 * 2. Assert world invariants (optional)
 * 3. Process input-driven movement (WASD velocity + collision)
 * 4. Process path-following movement (A* waypoints)
 * 5. Broadcast player_update events for moving players
 * 6. Advance conversation state machine
 * 7. Sync player.state / currentConvoId with ConversationManager
 * 8. Assert world invariants again
 * 9. Emit tick_complete; invoke afterTick callbacks
 *
 * ## Movement subsystems
 * Input movement and path movement are **mutually exclusive per player**:
 * pressing a key cancels any active A* path, and setting a path clears
 * held input. This prevents the two systems from fighting over position.
 *
 * @see docs/server-engine.md for diagrams and constant tables
 */
import {
  PLAYER_RADIUS,
  findBlockedTileOverlap,
  moveWithCollision,
} from "./collision.js";
import {
  type Conversation,
  ConversationManager,
  type NpcInviteDecisionProvider,
  snapshotConversation,
} from "./conversation.js";
import { GameLogger } from "./logger.js";
import {
  HUMAN_DEFAULT_PATH_SPEED,
  computeNpcPathSpeed,
} from "./movementConfig.js";
import { findPath } from "./pathfinding.js";
import { SeededRNG } from "./rng.js";
import type {
  Command,
  GameEvent,
  MapData,
  Orientation,
  Player,
  PlayerState,
  Position,
  TickResult,
  Traits,
} from "./types.js";
import { World } from "./world.js";

export type GameMode = "stepped" | "realtime";

type EventHandler = (event: GameEvent) => void;
type CommandHandler = (command: Command) => void;
/** Tolerance when comparing player-to-player distance (avoids false positives from float rounding). */
const PLAYER_COLLISION_EPSILON = 1e-6;
type InputDirection = "up" | "down" | "left" | "right";

/** Tracks which arrow/WASD keys a player is currently holding down.
 *  Converted into inputX/inputY (-1/0/+1) each tick to drive velocity. */
interface HeldInputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

function createHeldInputState(): HeldInputState {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
  };
}

export interface GameLoopOptions {
  seed?: number;
  mode?: GameMode;
  tickRate?: number; // ticks per second in realtime mode
  validateInvariants?: boolean;
}

export class GameLoop {
  /** Monotonically increasing tick counter; incremented once per tick() call. */
  private tick_ = 0;
  /** Current simulation mode: "stepped" (manual) or "realtime" (auto-tick via setInterval). */
  private mode_: GameMode;
  /** Target ticks per second when running in realtime mode. */
  private tickRate_: number;
  /** Immutable tile grid; null until loadWorld() is called. */
  private world_: World | null = null;
  /** All live players (human and NPC) keyed by player ID. This is the authoritative player state. */
  private players_: Map<string, Player> = new Map();
  /** Per-player keyboard state for WASD/arrow input, keyed by player ID.
   *  Tracks which directional keys are currently held so the tick loop can
   *  compute inputX/inputY each frame. Created/removed alongside the player. */
  private heldKeys_: Map<string, HeldInputState> = new Map();
  /** When true, assertWorldInvariants() runs at the start and end of each tick (debug/test aid). */
  private validateInvariants_: boolean;
  /** Seeded PRNG for deterministic NPC behavior and reproducible tests. */
  private rng_: SeededRNG;
  /** Handle for the realtime mode setInterval; null when stopped or in stepped mode. */
  private intervalId: ReturnType<typeof setInterval> | null = null;
  /** Registered event listeners keyed by event type (or "*" for all events).
   *  The WebSocket server subscribes via on("*", ...) to broadcast game events. */
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  /** Fixed-size ring buffer of recent GameEvents for the debug API's /log endpoint. */
  private logger_: GameLogger = new GameLogger();
  /** Manages conversation lifecycle (invite → walk → active → ended) and the player↔convo index. */
  private convoManager_: ConversationManager = new ConversationManager();
  /** FIFO queue of commands (spawn, move, say, …) drained at the start of each tick.
   *  Commands are enqueued from WebSocket handlers and the debug API, then processed
   *  in order so that all mutations happen inside the tick pipeline. */
  private commandQueue_: Command[] = [];
  /** Optional handlers for commands owned by subsystems outside the core engine. */
  private commandHandlers_: Map<Command["type"], CommandHandler[]> = new Map();
  /** Optional runtime hook that lets the autonomy system decide how NPC invitees respond. */
  private npcInviteDecisionProvider_?: NpcInviteDecisionProvider;
  /** Callbacks invoked after every tick completes; used by the NPC controller to schedule AI turns. */
  private afterTickCallbacks: ((result: TickResult) => void)[] = [];

  constructor(options: GameLoopOptions = {}) {
    this.rng_ = new SeededRNG(options.seed ?? Date.now());
    this.mode_ = options.mode ?? "stepped";
    this.tickRate_ = options.tickRate ?? 2;
    this.validateInvariants_ = options.validateInvariants ?? false;
  }

  // --- World ---

  loadWorld(mapData: MapData): void {
    this.world_ = new World(mapData);
  }

  get world(): World {
    if (!this.world_) throw new Error("World not loaded");
    return this.world_;
  }

  // --- Players ---

  spawnPlayer(params: {
    id: string;
    name: string;
    x: number;
    y: number;
    isNpc?: boolean;
    description?: string;
    personality?: string;
    speed?: number;
    traits?: Traits;
  }): Player {
    if (this.players_.has(params.id)) {
      throw new Error(`Player ${params.id} already exists`);
    }

    const isNpc = params.isNpc ?? false;
    const defaultPathSpeed = isNpc
      ? computeNpcPathSpeed(params.id)
      : HUMAN_DEFAULT_PATH_SPEED;
    const player: Player = {
      id: params.id,
      name: params.name,
      description: params.description ?? "",
      personality: params.personality,
      isNpc,
      isWaitingForResponse: false,
      x: params.x,
      y: params.y,
      orientation: "down",
      pathSpeed: params.speed ?? defaultPathSpeed,
      state: "idle",
      vx: 0,
      vy: 0,
      inputX: 0,
      inputY: 0,
      radius: PLAYER_RADIUS,
      inputSpeed: 5.0,
      hp: 100,
      maxHp: 100,
      traits: params.traits,
    };

    this.players_.set(params.id, player);
    this.heldKeys_.set(params.id, createHeldInputState());
    this.emit({
      tick: this.tick_,
      type: "spawn",
      playerId: params.id,
      data: { x: params.x, y: params.y },
    });
    return player;
  }

  removePlayer(id: string, data?: Record<string, unknown>): void {
    const player = this.players_.get(id);
    if (!player) {
      return;
    }

    const convo = this.convoManager_.getPlayerConversation(id);
    if (convo && convo.state !== "ended") {
      const ended = this.convoManager_.endConversation(
        convo.id,
        this.tick_,
        "missing_player",
      );
      this.emit({
        tick: this.tick_,
        type: "convo_ended",
        playerId: id,
        data: this.buildConversationEventData(ended, {
          reason: ended.endedReason,
        }),
      });
    }

    this.players_.delete(id);
    this.heldKeys_.delete(id);
    this.emit({ tick: this.tick_, type: "despawn", playerId: id, data });
  }

  getPlayer(id: string): Player | undefined {
    return this.players_.get(id);
  }

  getPlayers(): Player[] {
    return Array.from(this.players_.values());
  }

  setPlayerWaitingForResponse(playerId: string, waiting: boolean): boolean {
    const player = this.players_.get(playerId);
    if (!player || player.isWaitingForResponse === waiting) {
      return false;
    }

    player.isWaitingForResponse = waiting;
    this.emit(this.buildPlayerUpdateEvent(player));
    return true;
  }

  // --- Movement ---

  setPlayerTarget(playerId: string, x: number, y: number): Position[] | null {
    const player = this.players_.get(playerId);
    if (!player) return null;
    if (player.state === "conversing") return null;

    this.clearManualInput(player);
    const start: Position = {
      x: Math.round(player.x),
      y: Math.round(player.y),
    };
    const goal: Position = { x, y };

    const path = findPath(this.world, start, goal);
    if (!path) return null;
    this.assertPathIsCardinal(path, playerId);

    this.cancelPath(player, "move_to");
    player.path = path;
    player.pathIndex = 0;
    player.targetX = x;
    player.targetY = y;
    player.state = "walking";

    this.emit({
      tick: this.tick_,
      type: "move_start",
      playerId,
      data: { targetX: x, targetY: y, pathLength: path.length },
    });
    return path;
  }

  /** Move a player one tile in a direction immediately (no pathfinding). Returns true if moved. */
  movePlayerDirection(
    playerId: string,
    direction: "up" | "down" | "left" | "right",
  ): boolean {
    const player = this.players_.get(playerId);
    if (!player) return false;
    if (player.state === "conversing") return false;

    this.clearManualInput(player);
    this.cancelPath(player, "move_direction");
    const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
    const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;

    const newX = Math.round(player.x) + dx;
    const newY = Math.round(player.y) + dy;

    if (!this.world.isWalkable(newX, newY)) return false;
    const blocker = this.findBlockingPlayer(
      player.id,
      newX,
      newY,
      player.radius,
    );
    if (blocker) {
      this.emit({
        tick: this.tick_,
        type: "player_collision",
        playerId,
        data: {
          mode: "move_direction",
          blockerId: blocker.id,
          attemptedX: newX,
          attemptedY: newY,
          resolvedX: player.x,
          resolvedY: player.y,
        },
      });
      return false;
    }
    player.x = newX;
    player.y = newY;
    player.orientation = direction;
    player.state = "idle";

    this.emit({
      tick: this.tick_,
      type: "move_direction",
      playerId,
      data: { x: newX, y: newY, orientation: direction, player: { ...player } },
    });

    return true;
  }

  /**
   * Toggle a directional key for a player (from input_start/input_stop messages).
   *
   * This is the entry point for WASD / arrow key movement. When any key becomes
   * active, any in-progress A* path is cancelled. The held-key state is converted
   * into `inputX`/`inputY` on the player, which `processInputMovement` picks up
   * on the next tick.
   */
  setPlayerInput(
    playerId: string,
    direction: InputDirection,
    active: boolean,
  ): void {
    const player = this.players_.get(playerId);
    if (!player) return;
    if (player.state === "conversing") return;
    const held = this.getHeldInputState(playerId);

    if (active) {
      // Cancel any existing A* path
      this.cancelPath(player, "input");
    }

    held[direction] = active;
    this.applyHeldInputState(player, held);
    if (player.inputX === 0 && player.inputY === 0) {
      player.vx = 0;
      player.vy = 0;
      if (player.state === "walking" && !player.path) {
        player.state = "idle";
      }
    }
    this.emit({
      tick: this.tick_,
      type: "input_state",
      playerId,
      data: {
        direction,
        active,
        held: { ...held },
        inputX: player.inputX,
        inputY: player.inputY,
      },
    });
  }

  // --- Command Queue ---

  /** Queue a command for processing on the next tick */
  enqueue(command: Command): void {
    this.commandQueue_.push(command);
  }

  /**
   * Drain only the queued commands without advancing simulation time.
   *
   * Audit note: this exists for debug/admin surfaces that must reuse the same
   * command-processing path as production, but should not trigger movement,
   * timers, or a synthetic `tick_complete` event.
   */
  processPendingCommands(): void {
    this.processCommands();
    this.assertWorldInvariants();

    // Command handlers can create/end conversations, so keep the derived player
    // conversation fields aligned even when no full tick runs afterward.
    const convoStateEvents = this.syncPlayerConvoState();
    for (const event of convoStateEvents) {
      this.emit(event);
    }

    this.assertWorldInvariants();
  }

  /** Register a handler for commands implemented by external subsystems. */
  onCommand<T extends Command["type"]>(
    type: T,
    handler: (command: Extract<Command, { type: T }>) => void,
  ): void {
    const handlers = this.commandHandlers_.get(type) ?? [];
    handlers.push(handler as CommandHandler);
    this.commandHandlers_.set(type, handlers);
  }

  private processCommands(): void {
    const commands = this.commandQueue_;
    this.commandQueue_ = [];

    for (const cmd of commands) {
      switch (cmd.type) {
        case "spawn": {
          if (!this.players_.has(cmd.playerId)) {
            this.spawnPlayer({
              id: cmd.playerId,
              name: cmd.data.name,
              x: cmd.data.x,
              y: cmd.data.y,
              isNpc: cmd.data.isNpc,
              description: cmd.data.description,
              personality: cmd.data.personality,
              speed: cmd.data.speed,
              traits: cmd.data.traits,
            });
          }
          break;
        }
        case "remove": {
          this.removePlayer(cmd.playerId);
          break;
        }
        case "move_to": {
          this.setPlayerTarget(cmd.playerId, cmd.data.x, cmd.data.y);
          break;
        }
        case "move_direction": {
          this.movePlayerDirection(cmd.playerId, cmd.data.direction);
          break;
        }
        case "start_convo": {
          const target = this.players_.get(cmd.data.targetId);
          if (!target || cmd.playerId === cmd.data.targetId) {
            break;
          }
          const convo = this.convoManager_.tryStartConversation(
            cmd.playerId,
            cmd.data.targetId,
            this.tick_,
          );
          if (convo) {
            this.emit({
              tick: this.tick_,
              type: "convo_started",
              playerId: cmd.playerId,
              data: this.buildConversationEventData(convo, {
                targetId: cmd.data.targetId,
              }),
            });
          }
          break;
        }
        case "accept_convo": {
          const convo = this.convoManager_.tryAcceptInvite(
            cmd.data.convoId,
            cmd.playerId,
          );
          if (convo) {
            this.emit({
              tick: this.tick_,
              type: "convo_accepted",
              playerId: cmd.playerId,
              data: this.buildConversationEventData(convo),
            });
          }
          break;
        }
        case "decline_convo": {
          const convo = this.convoManager_.tryDeclineInvite(
            cmd.data.convoId,
            cmd.playerId,
            this.tick_,
          );
          if (convo) {
            this.emit({
              tick: this.tick_,
              type: "convo_declined",
              playerId: cmd.playerId,
              data: this.buildConversationEventData(convo),
            });
            this.emit({
              tick: this.tick_,
              type: "convo_ended",
              playerId: cmd.playerId,
              data: this.buildConversationEventData(convo, {
                reason: convo.endedReason,
              }),
            });
          }
          break;
        }
        case "end_convo": {
          const convo = this.convoManager_.getConversation(cmd.data.convoId);
          if (
            !convo ||
            !this.convoManager_.isParticipant(convo, cmd.playerId)
          ) {
            break;
          }
          const ended = this.convoManager_.tryEndConversation(
            cmd.data.convoId,
            this.tick_,
          );
          if (ended) {
            this.emit({
              tick: this.tick_,
              type: "convo_ended",
              playerId: cmd.playerId,
              data: this.buildConversationEventData(ended, {
                reason: ended.endedReason,
              }),
            });
          }
          break;
        }
        case "say": {
          const result = this.convoManager_.tryAddMessage(
            cmd.data.convoId,
            cmd.playerId,
            cmd.data.content,
            this.tick_,
          );
          if (result) {
            this.emit({
              tick: this.tick_,
              type: "convo_message",
              playerId: cmd.playerId,
              data: {
                message: { ...result.message },
                convoId: result.conversation.id,
                participantIds: this.convoManager_.getParticipantIds(
                  result.conversation,
                ),
              },
            });
          }
          break;
        }
        case "attack":
        case "pickup":
        case "eat": {
          this.dispatchExternalCommand(cmd);
          break;
        }
      }
    }
  }

  private dispatchExternalCommand(command: Command): void {
    const handlers = this.commandHandlers_.get(command.type);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(command);
    }
  }

  // --- Tick ---

  tick(): TickResult {
    this.tick_++;
    const events: GameEvent[] = [];

    // 1. Drain command queue
    this.processCommands();
    this.assertWorldInvariants();

    // 2. Process input-driven movement (velocity-based, continuous).
    //    This and path movement below are mutually exclusive per player:
    //    setPlayerInput() cancels any active A* path, so a player is
    //    never in both systems during the same tick.
    const dt = 1 / this.tickRate_;
    for (const player of this.players_.values()) {
      if (player.state === "conversing") continue;
      if (player.inputX !== 0 || player.inputY !== 0) {
        const inputEvents = this.processInputMovement(player, dt);
        for (const e of inputEvents) this.emit(e);
        events.push(...inputEvents);
      } else if (player.vx !== 0 || player.vy !== 0) {
        // Input stopped — zero velocity
        player.vx = 0;
        player.vy = 0;
        if (player.state === "walking" && !player.path) {
          player.state = "idle";
        }
      }
    }

    // 3. Process path-following movement for all walking players
    for (const player of this.players_.values()) {
      if (
        player.state === "walking" &&
        player.path &&
        player.pathIndex !== undefined
      ) {
        const moveEvents = this.processMovement(player);
        for (const e of moveEvents) this.emit(e);
        events.push(...moveEvents);
      }
    }

    // 4. Emit player_update for moving players (for broadcasting)
    for (const player of this.players_.values()) {
      if (player.state === "walking" || player.vx !== 0 || player.vy !== 0) {
        const evt = this.buildPlayerUpdateEvent(player);
        this.emit(evt);
        events.push(evt);
      }
    }

    // 5. Process conversations
    const convoEvents = this.convoManager_.processTick(
      this.tick_,
      (id) => this.players_.get(id),
      (playerId, x, y) => this.setPlayerTarget(playerId, x, y) !== null,
      this.npcInviteDecisionProvider_,
    );
    for (const e of convoEvents) this.emit(e);
    events.push(...convoEvents);

    // 6. Sync player convo state
    const convoStateEvents = this.syncPlayerConvoState();
    for (const event of convoStateEvents) this.emit(event);
    events.push(...convoStateEvents);

    this.assertWorldInvariants();

    // 7. Emit tick_complete
    const tickEvt: GameEvent = {
      tick: this.tick_,
      type: "tick_complete",
      data: { tick: this.tick_ },
    };
    this.emit(tickEvt);
    events.push(tickEvt);

    const result = { tick: this.tick_, events };
    for (const cb of this.afterTickCallbacks) cb(result);
    return result;
  }

  /** Register a callback that runs after every tick */
  onAfterTick(callback: (result: TickResult) => void): void {
    this.afterTickCallbacks.push(callback);
  }

  setNpcInviteDecisionProvider(
    provider: NpcInviteDecisionProvider | undefined,
  ): void {
    this.npcInviteDecisionProvider_ = provider;
  }

  /**
   * Process velocity-based input movement for a single player.
   *
   * 1. Normalize diagonal input so diagonal speed equals cardinal speed.
   * 2. Compute velocity = normalized input * inputSpeed.
   * 3. Compute displacement = velocity * dt.
   * 4. Resolve tile collision via {@link moveWithCollision}.
   * 5. Resolve player-to-player collision via {@link resolveInputPlayerCollision}.
   * 6. Update orientation based on dominant input axis.
   */
  private processInputMovement(player: Player, dt: number): GameEvent[] {
    const events: GameEvent[] = [];
    const startX = player.x;
    const startY = player.y;

    // Normalize diagonal input so diagonal speed = cardinal speed
    let ix = player.inputX;
    let iy = player.inputY;
    const mag = Math.sqrt(ix * ix + iy * iy);
    if (mag > 0) {
      ix /= mag;
      iy /= mag;
    }

    // Set velocity
    player.vx = ix * player.inputSpeed;
    player.vy = iy * player.inputSpeed;

    const dx = player.vx * dt;
    const dy = player.vy * dt;

    const result = moveWithCollision(
      player.x,
      player.y,
      dx,
      dy,
      player.radius,
      this.world,
    );

    const resolved = this.resolveInputPlayerCollision(
      player,
      result.x,
      result.y,
    );
    player.x = resolved.x;
    player.y = resolved.y;
    player.state = "walking";
    this.assertCardinalInputStayedOnAxis(player, startX, startY);

    // Update orientation based on input
    if (Math.abs(player.inputX) > Math.abs(player.inputY)) {
      player.orientation = player.inputX > 0 ? "right" : "left";
    } else if (player.inputY !== 0) {
      player.orientation = player.inputY > 0 ? "down" : "up";
    }

    events.push({
      tick: this.tick_,
      type: "input_move",
      playerId: player.id,
      data: { x: player.x, y: player.y, vx: player.vx, vy: player.vy },
    });
    if (resolved.blocker) {
      events.push({
        tick: this.tick_,
        type: "player_collision",
        playerId: player.id,
        data: {
          mode: "input",
          blockerId: resolved.blocker.id,
          attemptedX: result.x,
          attemptedY: result.y,
          resolvedX: resolved.x,
          resolvedY: resolved.y,
        },
      });
    }

    return events;
  }

  /**
   * Advance a player along their A* path by up to `pathSpeed` tiles this tick.
   *
   * The player consumes waypoints until either the budget is exhausted or
   * a blocking player is encountered. Partial moves toward the next waypoint
   * are supported (the player can stop mid-tile). When the final waypoint
   * is reached, the path is cleared and state returns to idle.
   */
  private processMovement(player: Player): GameEvent[] {
    const events: GameEvent[] = [];
    if (!player.path || player.pathIndex === undefined) return events;

    const path = player.path;
    let pathIndex = player.pathIndex;

    // Move along path by speed (tiles per tick)
    let remaining = player.pathSpeed;
    while (remaining > 0 && pathIndex < path.length - 1) {
      const nextIdx: number = pathIndex + 1;
      const next = path[nextIdx];
      const dx = next.x - player.x;
      const dy = next.y - player.y;
      const dist = Math.abs(dx) + Math.abs(dy);

      if (dist <= remaining) {
        const blocker = this.findBlockingPlayer(
          player.id,
          next.x,
          next.y,
          player.radius,
        );
        if (blocker) {
          events.push({
            tick: this.tick_,
            type: "player_collision",
            playerId: player.id,
            data: {
              mode: "path",
              blockerId: blocker.id,
              attemptedX: next.x,
              attemptedY: next.y,
              resolvedX: player.x,
              resolvedY: player.y,
            },
          });
          break;
        }
        // Reach next waypoint
        player.x = next.x;
        player.y = next.y;
        pathIndex = nextIdx;
        player.pathIndex = nextIdx;
        remaining -= dist;

        // Update orientation based on movement direction
        player.orientation = this.getOrientation(dx, dy);
      } else {
        // Partial move toward next waypoint
        const ratio = remaining / dist;
        const nextX = player.x + dx * ratio;
        const nextY = player.y + dy * ratio;
        const blocker = this.findBlockingPlayer(
          player.id,
          nextX,
          nextY,
          player.radius,
        );
        if (blocker) {
          events.push({
            tick: this.tick_,
            type: "player_collision",
            playerId: player.id,
            data: {
              mode: "path",
              blockerId: blocker.id,
              attemptedX: nextX,
              attemptedY: nextY,
              resolvedX: player.x,
              resolvedY: player.y,
            },
          });
          break;
        }
        player.x = nextX;
        player.y = nextY;
        player.orientation = this.getOrientation(dx, dy);
        remaining = 0;
      }
    }

    // Check if destination reached
    if (pathIndex >= path.length - 1) {
      // Snap to final position
      const final = path[path.length - 1];
      player.x = final.x;
      player.y = final.y;
      player.path = undefined;
      player.pathIndex = undefined;
      player.targetX = undefined;
      player.targetY = undefined;
      player.state = "idle";
      events.push({
        tick: this.tick_,
        type: "move_end",
        playerId: player.id,
        data: { x: player.x, y: player.y },
      });
    }

    return events;
  }

  private getOrientation(dx: number, dy: number): Orientation {
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? "right" : "left";
    }
    return dy > 0 ? "down" : "up";
  }

  private clearManualInput(player: Player): void {
    const held = this.heldKeys_.get(player.id);
    if (held) {
      held.up = false;
      held.down = false;
      held.left = false;
      held.right = false;
    }
    player.inputX = 0;
    player.inputY = 0;
    player.vx = 0;
    player.vy = 0;
  }

  private cancelPath(
    player: Player,
    reason: "input" | "move_direction" | "move_to",
  ): void {
    if (
      player.path === undefined &&
      player.pathIndex === undefined &&
      player.targetX === undefined &&
      player.targetY === undefined
    ) {
      return;
    }

    this.emit({
      tick: this.tick_,
      type: "move_cancelled",
      playerId: player.id,
      data: {
        reason,
        x: player.x,
        y: player.y,
        targetX: player.targetX,
        targetY: player.targetY,
        pathIndex: player.pathIndex,
        pathLength: player.path?.length,
      },
    });

    player.path = undefined;
    player.pathIndex = undefined;
    player.targetX = undefined;
    player.targetY = undefined;
  }

  private getHeldInputState(playerId: string): HeldInputState {
    const existing = this.heldKeys_.get(playerId);
    if (existing) return existing;

    const created = createHeldInputState();
    this.heldKeys_.set(playerId, created);
    return created;
  }

  private applyHeldInputState(player: Player, held: HeldInputState): void {
    player.inputX = (held.left ? -1 : 0) + (held.right ? 1 : 0);
    player.inputY = (held.up ? -1 : 0) + (held.down ? 1 : 0);
  }

  /**
   * Validate world-level invariants (only when `validateInvariants` is true).
   *
   * Checks:
   * - No player overlaps a blocked tile
   * - Velocity is zero when input is zero
   * - All paths use cardinal (non-diagonal) steps on walkable tiles
   * - No two players overlap (radii within epsilon)
   */
  private assertWorldInvariants(): void {
    if (!this.validateInvariants_) return;

    for (const player of this.players_.values()) {
      this.assertPlayerNotInBlockedTile(player);
      this.assertVelocityMatchesInput(player);
      if (player.path) {
        this.assertPathIsCardinal(player.path, player.id);
      }
    }

    const players = this.getPlayers();
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const left = players[i];
        const right = players[j];
        const minDistance =
          left.radius + right.radius - PLAYER_COLLISION_EPSILON;
        const dx = left.x - right.x;
        const dy = left.y - right.y;
        if (dx * dx + dy * dy < minDistance * minDistance) {
          throw new Error(
            `Invariant failed: players ${left.id} and ${right.id} overlap`,
          );
        }
      }
    }
  }

  private assertPlayerNotInBlockedTile(player: Player): void {
    const overlap = findBlockedTileOverlap(
      player.x,
      player.y,
      player.radius,
      this.world,
    );
    if (overlap) {
      throw new Error(
        `Invariant failed: player ${player.id} overlaps blocked tile (${overlap.x}, ${overlap.y})`,
      );
    }
  }

  private assertVelocityMatchesInput(player: Player): void {
    if (
      player.inputX === 0 &&
      player.inputY === 0 &&
      (Math.abs(player.vx) > 1e-6 || Math.abs(player.vy) > 1e-6)
    ) {
      throw new Error(
        `Invariant failed: player ${player.id} has velocity without active input`,
      );
    }
  }

  private assertPathIsCardinal(path: Position[], playerId: string): void {
    if (!this.validateInvariants_) return;
    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1];
      const current = path[i];
      const dx = Math.abs(current.x - prev.x);
      const dy = Math.abs(current.y - prev.y);
      if (dx + dy !== 1) {
        throw new Error(
          `Invariant failed: player ${playerId} has non-cardinal path step ${i - 1}->${i}`,
        );
      }
      if (!this.world.isWalkable(current.x, current.y)) {
        throw new Error(
          `Invariant failed: player ${playerId} path enters blocked tile (${current.x}, ${current.y})`,
        );
      }
    }
  }

  private assertCardinalInputStayedOnAxis(
    player: Player,
    startX: number,
    startY: number,
  ): void {
    if (!this.validateInvariants_) return;
    if (
      player.inputX !== 0 &&
      player.inputY === 0 &&
      Math.abs(player.y - startY) > 1e-6
    ) {
      throw new Error(
        `Invariant failed: player ${player.id} drifted on Y during horizontal input`,
      );
    }
    if (
      player.inputY !== 0 &&
      player.inputX === 0 &&
      Math.abs(player.x - startX) > 1e-6
    ) {
      throw new Error(
        `Invariant failed: player ${player.id} drifted on X during vertical input`,
      );
    }
  }

  private findBlockingPlayer(
    playerId: string,
    x: number,
    y: number,
    radius: number,
  ): Player | undefined {
    for (const other of this.players_.values()) {
      if (other.id === playerId) continue;
      const minDistance = radius + other.radius - PLAYER_COLLISION_EPSILON;
      const dx = x - other.x;
      const dy = y - other.y;
      if (dx * dx + dy * dy < minDistance * minDistance) {
        return other;
      }
    }
    return undefined;
  }

  /**
   * Resolve player-to-player collision after input movement.
   *
   * Strategy: try the full (nextX, nextY). If blocked, try each axis
   * independently. If both single-axis moves are clear, pick the axis
   * with more progress. If both are blocked, stay put.
   * This lets the player "slide" along another player during diagonal input.
   */
  private resolveInputPlayerCollision(
    player: Player,
    nextX: number,
    nextY: number,
  ): { x: number; y: number; blocker?: Player } {
    const blocker = this.findBlockingPlayer(
      player.id,
      nextX,
      nextY,
      player.radius,
    );
    if (!blocker) return { x: nextX, y: nextY };

    const xOnlyBlocker = this.findBlockingPlayer(
      player.id,
      nextX,
      player.y,
      player.radius,
    );
    const yOnlyBlocker = this.findBlockingPlayer(
      player.id,
      player.x,
      nextY,
      player.radius,
    );

    if (!xOnlyBlocker && !yOnlyBlocker) {
      const xProgress = Math.abs(nextX - player.x);
      const yProgress = Math.abs(nextY - player.y);
      if (xProgress >= yProgress) {
        return { x: nextX, y: player.y, blocker };
      }
      return { x: player.x, y: nextY, blocker };
    }

    if (!xOnlyBlocker) {
      return { x: nextX, y: player.y, blocker };
    }

    if (!yOnlyBlocker) {
      return { x: player.x, y: nextY, blocker };
    }

    return { x: player.x, y: player.y, blocker };
  }

  /** Keep player.state and player.currentConvoId in sync with ConversationManager */
  private syncPlayerConvoState(): GameEvent[] {
    const events: GameEvent[] = [];
    for (const player of this.players_.values()) {
      const convo = this.convoManager_.getPlayerConversation(player.id);
      const prevState = player.state;
      const prevConvoId = player.currentConvoId;
      if (convo && convo.state === "active") {
        player.state = "conversing";
        player.currentConvoId = convo.id;
      } else if (player.state === "conversing") {
        // Conversation ended or not found
        player.state = "idle";
        player.currentConvoId = undefined;
      }

      if (player.state !== prevState || player.currentConvoId !== prevConvoId) {
        events.push(this.buildPlayerUpdateEvent(player));
      }
    }

    return events;
  }

  private buildConversationEventData(
    conversation:
      | Conversation
      | {
          id: number;
          player1Id: string;
          player2Id: string;
          endedReason?: string;
        },
    extra: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      convoId: conversation.id,
      conversation:
        "messages" in conversation
          ? snapshotConversation(conversation)
          : { ...conversation },
      participantIds: this.convoManager_.getParticipantIds(conversation),
      ...extra,
    };
  }

  private buildPlayerUpdateEvent(player: Player): GameEvent {
    return {
      tick: this.tick_,
      type: "player_update",
      playerId: player.id,
      data: { player: { ...player } },
    };
  }

  // --- Realtime mode ---

  start(): void {
    if (this.mode_ !== "realtime") return;
    if (this.intervalId) return;
    const ms = Math.round(1000 / this.tickRate_);
    this.intervalId = setInterval(() => this.tick(), ms);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  // --- Events ---

  on(type: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(type) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(type, handlers);
  }

  private emit(event: GameEvent): void {
    this.logger_.log(event);
    const handlers = this.eventHandlers.get(event.type) ?? [];
    for (const h of handlers) h(event);
    // Also emit to wildcard listeners
    const allHandlers = this.eventHandlers.get("*") ?? [];
    for (const h of allHandlers) h(event);
  }

  /** Public event emitter for external systems (e.g. BearManager). */
  emitEvent(event: GameEvent): void {
    this.emit(event);
  }

  // --- State ---

  get currentTick(): number {
    return this.tick_;
  }

  get mode(): GameMode {
    return this.mode_;
  }

  set mode(m: GameMode) {
    if (m === "realtime" && this.mode_ !== "realtime") {
      this.mode_ = m;
      this.start();
    } else if (m === "stepped") {
      this.stop();
      this.mode_ = m;
    }
  }

  get tickRate(): number {
    return this.tickRate_;
  }

  get rng(): SeededRNG {
    return this.rng_;
  }

  get playerCount(): number {
    return this.players_.size;
  }

  get logger(): GameLogger {
    return this.logger_;
  }

  get conversations(): ConversationManager {
    return this.convoManager_;
  }

  reset(): void {
    this.stop();
    this.tick_ = 0;
    this.players_.clear();
    this.heldKeys_.clear();
    this.world_ = null;
    this.logger_.clear();
    this.convoManager_.clear();
    this.commandQueue_ = [];
  }
}
