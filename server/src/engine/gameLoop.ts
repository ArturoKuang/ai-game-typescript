import { PLAYER_RADIUS, moveWithCollision } from "./collision.js";
import { ConversationManager } from "./conversation.js";
import { GameLogger } from "./logger.js";
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
} from "./types.js";
import { World } from "./world.js";

export type GameMode = "stepped" | "realtime";

type EventHandler = (event: GameEvent) => void;

export interface GameLoopOptions {
  seed?: number;
  mode?: GameMode;
  tickRate?: number; // ticks per second in realtime mode
}

export class GameLoop {
  private tick_ = 0;
  private mode_: GameMode;
  private tickRate_: number;
  private world_: World | null = null;
  private players_: Map<string, Player> = new Map();
  private rng_: SeededRNG;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private logger_: GameLogger = new GameLogger();
  private convoManager_: ConversationManager = new ConversationManager();
  private commandQueue_: Command[] = [];
  private afterTickCallbacks: ((result: TickResult) => void)[] = [];

  constructor(options: GameLoopOptions = {}) {
    this.rng_ = new SeededRNG(options.seed ?? Date.now());
    this.mode_ = options.mode ?? "stepped";
    this.tickRate_ = options.tickRate ?? 2;
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
  }): Player {
    if (this.players_.has(params.id)) {
      throw new Error(`Player ${params.id} already exists`);
    }

    const player: Player = {
      id: params.id,
      name: params.name,
      description: params.description ?? "",
      personality: params.personality,
      isNpc: params.isNpc ?? false,
      x: params.x,
      y: params.y,
      orientation: "down",
      speed: params.speed ?? 1.0,
      state: "idle",
      vx: 0,
      vy: 0,
      inputX: 0,
      inputY: 0,
      radius: PLAYER_RADIUS,
      moveSpeed: 5.0,
    };

    this.players_.set(params.id, player);
    this.emit({
      tick: this.tick_,
      type: "spawn",
      playerId: params.id,
      data: { x: params.x, y: params.y },
    });
    return player;
  }

  removePlayer(id: string): void {
    this.players_.delete(id);
    this.emit({ tick: this.tick_, type: "despawn", playerId: id });
  }

  getPlayer(id: string): Player | undefined {
    return this.players_.get(id);
  }

  getPlayers(): Player[] {
    return Array.from(this.players_.values());
  }

  // --- Movement ---

  setPlayerTarget(playerId: string, x: number, y: number): Position[] | null {
    const player = this.players_.get(playerId);
    if (!player) return null;
    if (player.state === "conversing") return null;

    const start: Position = {
      x: Math.round(player.x),
      y: Math.round(player.y),
    };
    const goal: Position = { x, y };

    const path = findPath(this.world, start, goal);
    if (!path) return null;

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

    const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
    const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;

    const newX = Math.round(player.x) + dx;
    const newY = Math.round(player.y) + dy;

    if (!this.world.isWalkable(newX, newY)) return false;

    // Cancel any existing pathfinding
    player.path = undefined;
    player.pathIndex = undefined;
    player.targetX = undefined;
    player.targetY = undefined;

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

  /** Set input direction for a player (from input_start/input_stop messages). */
  setPlayerInput(
    playerId: string,
    direction: "up" | "down" | "left" | "right",
    active: boolean,
  ): void {
    const player = this.players_.get(playerId);
    if (!player) return;
    if (player.state === "conversing") return;

    const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
    const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;

    if (active) {
      // Cancel any existing A* path
      player.path = undefined;
      player.pathIndex = undefined;
      player.targetX = undefined;
      player.targetY = undefined;

      player.inputX = dx;
      player.inputY = dy;
    } else {
      // Only clear the axis that matches this direction
      if (dx !== 0 && player.inputX === dx) player.inputX = 0;
      if (dy !== 0 && player.inputY === dy) player.inputY = 0;
    }
  }

  // --- Command Queue ---

  /** Queue a command for processing on the next tick */
  enqueue(command: Command): void {
    this.commandQueue_.push(command);
  }

  private processCommands(): void {
    const commands = this.commandQueue_;
    this.commandQueue_ = [];

    for (const cmd of commands) {
      switch (cmd.type) {
        case "spawn": {
          try {
            this.spawnPlayer({
              id: cmd.playerId,
              name: cmd.data.name,
              x: cmd.data.x,
              y: cmd.data.y,
              isNpc: cmd.data.isNpc,
              description: cmd.data.description,
              personality: cmd.data.personality,
              speed: cmd.data.speed,
            });
          } catch {
            // Player already exists — skip
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
          try {
            const convo = this.convoManager_.startConversation(
              cmd.playerId,
              cmd.data.targetId,
              this.tick_,
            );
            this.emit({
              tick: this.tick_,
              type: "convo_started",
              playerId: cmd.playerId,
              data: {
                convoId: convo.id,
                targetId: cmd.data.targetId,
                conversation: { ...convo },
              },
            });
          } catch {
            // Already in conversation — skip
          }
          break;
        }
        case "end_convo": {
          try {
            const convo = this.convoManager_.endConversation(
              cmd.data.convoId,
              this.tick_,
            );
            this.emit({
              tick: this.tick_,
              type: "convo_ended",
              playerId: cmd.playerId,
              data: { convoId: cmd.data.convoId, conversation: { ...convo } },
            });
          } catch {
            // Conversation not found or already ended
          }
          break;
        }
        case "say": {
          try {
            const msg = this.convoManager_.addMessage(
              cmd.data.convoId,
              cmd.playerId,
              cmd.data.content,
              this.tick_,
            );
            this.emit({
              tick: this.tick_,
              type: "convo_message",
              playerId: cmd.playerId,
              data: { message: { ...msg }, convoId: cmd.data.convoId },
            });
          } catch {
            // Not in active conversation — skip
          }
          break;
        }
      }
    }
  }

  // --- Tick ---

  tick(): TickResult {
    this.tick_++;
    const events: GameEvent[] = [];

    // 1. Drain command queue
    this.processCommands();

    // 2. Process input-driven movement (velocity-based, continuous)
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
      if (
        player.state === "walking" ||
        player.vx !== 0 ||
        player.vy !== 0
      ) {
        const evt: GameEvent = {
          tick: this.tick_,
          type: "player_update",
          playerId: player.id,
          data: { player: { ...player } },
        };
        this.emit(evt);
        events.push(evt);
      }
    }

    // 5. Process conversations
    const convoEvents = this.convoManager_.processTick(
      this.tick_,
      (id) => this.players_.get(id),
      (playerId, x, y) => this.setPlayerTarget(playerId, x, y),
    );
    for (const e of convoEvents) this.emit(e);
    events.push(...convoEvents);

    // 6. Sync player convo state
    this.syncPlayerConvoState();

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

  /** Process velocity-based input movement for a player */
  private processInputMovement(player: Player, dt: number): GameEvent[] {
    const events: GameEvent[] = [];

    // Normalize diagonal input so diagonal speed = cardinal speed
    let ix = player.inputX;
    let iy = player.inputY;
    const mag = Math.sqrt(ix * ix + iy * iy);
    if (mag > 0) {
      ix /= mag;
      iy /= mag;
    }

    // Set velocity
    player.vx = ix * player.moveSpeed;
    player.vy = iy * player.moveSpeed;

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

    player.x = result.x;
    player.y = result.y;
    player.state = "walking";

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

    return events;
  }

  private processMovement(player: Player): GameEvent[] {
    const events: GameEvent[] = [];
    if (!player.path || player.pathIndex === undefined) return events;

    const path = player.path;
    let pathIndex = player.pathIndex;

    // Move along path by speed (tiles per tick)
    let remaining = player.speed;
    while (remaining > 0 && pathIndex < path.length - 1) {
      const nextIdx: number = pathIndex + 1;
      const next = path[nextIdx];
      const dx = next.x - player.x;
      const dy = next.y - player.y;
      const dist = Math.abs(dx) + Math.abs(dy);

      if (dist <= remaining) {
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
        player.x += dx * ratio;
        player.y += dy * ratio;
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

  /** Keep player.state and player.currentConvoId in sync with ConversationManager */
  private syncPlayerConvoState(): void {
    for (const player of this.players_.values()) {
      const convo = this.convoManager_.getPlayerConversation(player.id);
      if (convo && convo.state === "active") {
        player.state = "conversing";
        player.currentConvoId = convo.id;
      } else if (player.state === "conversing") {
        // Conversation ended or not found
        player.state = "idle";
        player.currentConvoId = undefined;
      }
    }
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
    this.world_ = null;
    this.logger_.clear();
    this.convoManager_.clear();
    this.commandQueue_ = [];
  }
}
