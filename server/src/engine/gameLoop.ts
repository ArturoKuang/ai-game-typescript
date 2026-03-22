import { ConversationManager } from './conversation.js';
import { GameLogger } from './logger.js';
import { findPath } from './pathfinding.js';
import { SeededRNG } from './rng.js';
import type { GameEvent, MapData, Orientation, Player, PlayerState, Position, TickResult } from './types.js';
import { World } from './world.js';

export type GameMode = 'stepped' | 'realtime';

type EventHandler = (event: GameEvent) => void;

export interface GameLoopOptions {
  seed?: number;
  mode?: GameMode;
  tickRate?: number; // ticks per second in realtime mode
}

export class GameLoop {
  private tick_: number = 0;
  private mode_: GameMode;
  private tickRate_: number;
  private world_: World | null = null;
  private players_: Map<string, Player> = new Map();
  private rng_: SeededRNG;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private logger_: GameLogger = new GameLogger();
  private convoManager_: ConversationManager = new ConversationManager();

  constructor(options: GameLoopOptions = {}) {
    this.rng_ = new SeededRNG(options.seed ?? Date.now());
    this.mode_ = options.mode ?? 'stepped';
    this.tickRate_ = options.tickRate ?? 2;
  }

  // --- World ---

  loadWorld(mapData: MapData): void {
    this.world_ = new World(mapData);
  }

  get world(): World {
    if (!this.world_) throw new Error('World not loaded');
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
      description: params.description ?? '',
      personality: params.personality,
      isNpc: params.isNpc ?? false,
      x: params.x,
      y: params.y,
      orientation: 'down',
      speed: params.speed ?? 1.0,
      state: 'idle',
    };

    this.players_.set(params.id, player);
    this.emit({ tick: this.tick_, type: 'spawn', playerId: params.id, data: { x: params.x, y: params.y } });
    return player;
  }

  removePlayer(id: string): void {
    this.players_.delete(id);
    this.emit({ tick: this.tick_, type: 'despawn', playerId: id });
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
    if (player.state === 'conversing') return null;

    const start: Position = { x: Math.round(player.x), y: Math.round(player.y) };
    const goal: Position = { x, y };

    const path = findPath(this.world, start, goal);
    if (!path) return null;

    player.path = path;
    player.pathIndex = 0;
    player.targetX = x;
    player.targetY = y;
    player.state = 'walking';

    this.emit({ tick: this.tick_, type: 'move_start', playerId, data: { targetX: x, targetY: y, pathLength: path.length } });
    return path;
  }

  // --- Tick ---

  tick(): TickResult {
    this.tick_++;
    const events: GameEvent[] = [];

    // Process movement for all walking players
    for (const player of this.players_.values()) {
      if (player.state === 'walking' && player.path && player.pathIndex !== undefined) {
        const moveEvents = this.processMovement(player);
        for (const e of moveEvents) this.emit(e);
        events.push(...moveEvents);
      }
    }

    // Process conversations
    const convoEvents = this.convoManager_.processTick(
      this.tick_,
      (id) => this.players_.get(id),
      (playerId, x, y) => this.setPlayerTarget(playerId, x, y),
    );
    for (const e of convoEvents) this.emit(e);
    events.push(...convoEvents);

    // Sync player convo state
    this.syncPlayerConvoState();

    return { tick: this.tick_, events };
  }

  private processMovement(player: Player): GameEvent[] {
    const events: GameEvent[] = [];
    if (!player.path || player.pathIndex === undefined) return events;

    // Move along path by speed (tiles per tick)
    let remaining = player.speed;
    while (remaining > 0 && player.pathIndex < player.path.length - 1) {
      const nextIdx = player.pathIndex + 1;
      const next = player.path[nextIdx];
      const dx = next.x - player.x;
      const dy = next.y - player.y;
      const dist = Math.abs(dx) + Math.abs(dy);

      if (dist <= remaining) {
        // Reach next waypoint
        player.x = next.x;
        player.y = next.y;
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
    if (player.pathIndex >= player.path.length - 1) {
      // Snap to final position
      const final = player.path[player.path.length - 1];
      player.x = final.x;
      player.y = final.y;
      player.path = undefined;
      player.pathIndex = undefined;
      player.targetX = undefined;
      player.targetY = undefined;
      player.state = 'idle';
      events.push({ tick: this.tick_, type: 'move_end', playerId: player.id, data: { x: player.x, y: player.y } });
    }

    return events;
  }

  private getOrientation(dx: number, dy: number): Orientation {
    if (Math.abs(dx) > Math.abs(dy)) {
      return dx > 0 ? 'right' : 'left';
    }
    return dy > 0 ? 'down' : 'up';
  }

  /** Keep player.state and player.currentConvoId in sync with ConversationManager */
  private syncPlayerConvoState(): void {
    for (const player of this.players_.values()) {
      const convo = this.convoManager_.getPlayerConversation(player.id);
      if (convo && convo.state === 'active') {
        player.state = 'conversing';
        player.currentConvoId = convo.id;
      } else if (player.state === 'conversing') {
        // Conversation ended or not found
        player.state = 'idle';
        player.currentConvoId = undefined;
      }
    }
  }

  // --- Realtime mode ---

  start(): void {
    if (this.mode_ !== 'realtime') return;
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
    const allHandlers = this.eventHandlers.get('*') ?? [];
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
    if (m === 'realtime' && this.mode_ !== 'realtime') {
      this.mode_ = m;
      this.start();
    } else if (m === 'stepped') {
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
  }
}
