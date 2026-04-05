/**
 * Bear monster system — AI, combat, loot, and Game-of-Life spawning.
 *
 * Bears are WorldEntities managed by the EntityManager. The BearManager
 * hooks into GameLoop.onAfterTick to run bear AI, process combat commands,
 * and evaluate the GoL cellular automaton for population control.
 */
import type { GameLoop } from "../engine/gameLoop.js";
import type { GameEvent, Position } from "../engine/types.js";
import type { NpcInventory } from "../autonomy/types.js";
import { EntityManager } from "../autonomy/entityManager.js";
import {
  addItem,
  removeItem,
  hasItem,
  createInventory,
} from "../autonomy/inventory.js";
import {
  BEAR_HP,
  BEAR_DAMAGE,
  BEAR_ATTACK_COOLDOWN,
  BEAR_AGGRO_RADIUS,
  BEAR_ATTACK_RANGE,
  BEAR_WANDER_INTERVAL,
  PLAYER_DEFAULT_HP,
  PLAYER_ATTACK_DAMAGE,
  PLAYER_ATTACK_RANGE,
  PLAYER_ATTACK_COOLDOWN,
  BEAR_MEAT_HEAL,
  PLAYER_INVENTORY_CAPACITY,
  GOL_EVAL_INTERVAL,
  GOL_NEIGHBORHOOD_RADIUS,
  GOL_BIRTH_MIN,
  GOL_BIRTH_MAX,
  GOL_SURVIVAL_MIN,
  GOL_SURVIVAL_MAX,
  GOL_LONELINESS_TICKS,
  BEAR_POPULATION_CAP,
  BEAR_POPULATION_MIN,
  BEAR_INITIAL_COUNT,
  BEAR_SPAWN_PLAYER_BUFFER,
  WILDERNESS_ACTIVITY_BUFFER,
} from "./bearConfig.js";

export type BearState = "idle" | "aggro" | "attacking" | "dead";

export interface BearCommand {
  type: "attack" | "pickup" | "eat";
  playerId: string;
  data: { targetBearId?: string; entityId?: string; item?: string };
}

export class BearManager {
  private wildernessZones: Position[] = [];
  private commandQueue: BearCommand[] = [];
  /** Per-player attack cooldown tracker (playerId -> last attack tick). */
  private playerAttackCooldowns = new Map<string, number>();
  /** Per-player inventory for human players. */
  private playerInventories = new Map<string, NpcInventory>();
  /** Accumulated events emitted during the current update cycle. */
  private pendingEvents: GameEvent[] = [];

  constructor(
    private game: GameLoop,
    private entities: EntityManager,
  ) {
    this.wildernessZones = this.computeWildernessZones();
    this.game.onCommand("attack", (cmd) => {
      this.enqueue({
        type: "attack",
        playerId: cmd.playerId,
        data: { targetBearId: cmd.data.targetBearId },
      });
    });
    this.game.onCommand("pickup", (cmd) => {
      this.enqueue({
        type: "pickup",
        playerId: cmd.playerId,
        data: { entityId: cmd.data.entityId },
      });
    });
    this.game.onCommand("eat", (cmd) => {
      this.enqueue({
        type: "eat",
        playerId: cmd.playerId,
        data: { item: cmd.data.item },
      });
    });
    this.game.onAfterTick((result) => this.update(result.tick));
  }

  /** Seed initial bear population at boot. */
  seedInitialBears(): void {
    for (let i = 0; i < BEAR_INITIAL_COUNT && i < this.wildernessZones.length; i++) {
      this.seedBear(0);
    }
  }

  /** Enqueue a combat command from the WebSocket layer. */
  enqueue(cmd: BearCommand): void {
    this.commandQueue.push(cmd);
  }

  /** Get a player's inventory (creates one if missing). */
  getInventory(playerId: string): NpcInventory {
    let inv = this.playerInventories.get(playerId);
    if (!inv) {
      inv = createInventory();
      this.playerInventories.set(playerId, inv);
    }
    return inv;
  }

  /** Get all live bears. */
  getBears() {
    return this.entities.getByType("bear");
  }

  /** Get all loot on the ground. */
  getLoot() {
    return this.entities.getByType("bear_meat");
  }

  /** Debug: spawn a bear at a specific position. */
  debugSpawnBear(x: number, y: number): string {
    return this.spawnBear({ x, y }, this.game.currentTick);
  }

  /** Debug: immediately kill a bear by ID. */
  debugKillBear(bearId: string): boolean {
    const bear = this.entities.get(bearId);
    if (!bear || bear.destroyed || bear.type !== "bear") return false;
    this.killBear(bearId, this.game.currentTick, "debug");
    return true;
  }

  // ---------------------------------------------------------------------------
  // Main update (called every tick via afterTick hook)
  // ---------------------------------------------------------------------------

  private update(tick: number): void {
    this.pendingEvents = [];

    // 1. Process queued commands
    this.processCommands(tick);

    // 2. Run AI for each live bear
    for (const bear of this.entities.getByType("bear")) {
      if (bear.properties.state === "dead") continue;
      this.updateBearAI(bear.id, tick);
    }

    // 3. Let nearby NPCs swing back once a bear is actively attacking.
    this.processAutomaticNpcAttacks(tick);

    // 4. GoL evaluation on cadence
    if (tick > 0 && tick % GOL_EVAL_INTERVAL === 0) {
      this.evaluateGameOfLife(tick);
    }

    // 5. Ensure minimum population
    if (this.liveBearCount() < BEAR_POPULATION_MIN) {
      this.seedBear(tick);
    }

    // 6. Emit accumulated events into the game's event log
    for (const evt of this.pendingEvents) {
      this.game.emitEvent(evt);
    }
  }

  // ---------------------------------------------------------------------------
  // Command processing
  // ---------------------------------------------------------------------------

  private processCommands(tick: number): void {
    const cmds = this.commandQueue.splice(0);
    for (const cmd of cmds) {
      switch (cmd.type) {
        case "attack":
          this.handlePlayerAttack(cmd.playerId, cmd.data.targetBearId!, tick);
          break;
        case "pickup":
          this.handlePickup(cmd.playerId, cmd.data.entityId!, tick);
          break;
        case "eat":
          this.handleEat(cmd.playerId, cmd.data.item!, tick);
          break;
      }
    }
  }

  private handlePlayerAttack(playerId: string, bearId: string, tick: number): void {
    const player = this.game.getPlayer(playerId);
    if (!player || (player.hp !== undefined && player.hp <= 0)) return;

    const bear = this.entities.get(bearId);
    if (!bear || bear.destroyed || bear.type !== "bear" || bear.properties.state === "dead") return;

    // Range check (Manhattan distance)
    const dist = Math.abs(player.x - bear.position.x) + Math.abs(player.y - bear.position.y);
    if (dist > PLAYER_ATTACK_RANGE + 1) return; // +1 for tile adjacency

    // Cooldown check
    const lastAttack = this.playerAttackCooldowns.get(playerId) ?? -Infinity;
    if (tick - lastAttack < PLAYER_ATTACK_COOLDOWN) return;
    this.playerAttackCooldowns.set(playerId, tick);

    // Deal damage
    const newHp = Math.max(0, (bear.properties.hp as number) - PLAYER_ATTACK_DAMAGE);
    this.entities.updateProperty(bearId, "hp", newHp);

    this.emitEvent(tick, "player_attack", playerId, {
      bearId,
      damage: PLAYER_ATTACK_DAMAGE,
      bearHp: newHp,
    });

    // Bear death
    if (newHp <= 0) {
      this.killBear(bearId, tick, "killed");
    }
  }

  private handlePickup(playerId: string, entityId: string, tick: number): void {
    const player = this.game.getPlayer(playerId);
    if (!player) return;

    const entity = this.entities.get(entityId);
    if (!entity || entity.destroyed) return;

    // Determine item from entity type
    let itemId: string;
    let quantity: number;
    if (entity.type === "bear_meat") {
      itemId = "bear_meat";
      quantity = 1;
    } else if (entity.type === "ground_item") {
      itemId = entity.properties.itemId as string;
      quantity = (entity.properties.quantity as number) ?? 1;
      if (!itemId) return;
    } else {
      return; // Not a pickupable entity
    }

    // Range check
    const dist = Math.abs(player.x - entity.position.x) + Math.abs(player.y - entity.position.y);
    if (dist > 1.5) return;

    // Capacity check: count distinct item types in inventory
    const inv = this.getInventory(playerId);
    if (inv.size >= PLAYER_INVENTORY_CAPACITY && !inv.has(itemId)) return;

    // Add to inventory and destroy ground entity
    addItem(inv, itemId, quantity);
    this.entities.destroy(entityId);

    this.emitEvent(tick, "item_pickup", playerId, { item: itemId, quantity, entityId });
  }

  private handleEat(playerId: string, item: string, tick: number): void {
    if (!["bear_meat", "raw_food", "cooked_food"].includes(item)) return;

    const player = this.game.getPlayer(playerId);
    if (!player) return;

    const inv = this.getInventory(playerId);
    if (!hasItem(inv, item)) return;

    removeItem(inv, item);

    if (item === "bear_meat") {
      const maxHp = player.maxHp ?? PLAYER_DEFAULT_HP;
      const currentHp = player.hp ?? maxHp;
      const newHp = Math.min(maxHp, currentHp + BEAR_MEAT_HEAL);
      player.hp = newHp;

      this.emitEvent(tick, "player_heal", playerId, {
        item: "bear_meat",
        healAmount: newHp - currentHp,
        hp: newHp,
        maxHp,
      });
    }

    this.emitEvent(tick, "item_consumed", playerId, {
      item,
    });
  }

  private processAutomaticNpcAttacks(tick: number): void {
    for (const player of this.game.getPlayers()) {
      if (!player.isNpc || player.state === "conversing") continue;
      if ((player.hp ?? player.maxHp ?? PLAYER_DEFAULT_HP) <= 0) continue;

      const pos = { x: Math.round(player.x), y: Math.round(player.y) };
      const targetBear = this.entities
        .getNearby(pos, PLAYER_ATTACK_RANGE + 1, "bear")
        .find((bear) => bear.properties.state === "attacking");

      if (!targetBear) continue;
      this.handlePlayerAttack(player.id, targetBear.id, tick);
    }
  }

  // ---------------------------------------------------------------------------
  // Bear AI state machine
  // ---------------------------------------------------------------------------

  private updateBearAI(bearId: string, tick: number): void {
    const bear = this.entities.get(bearId);
    if (!bear || bear.destroyed) return;

    const state = bear.properties.state as BearState;
    const players = this.game.getPlayers();

    switch (state) {
      case "idle":
        this.bearIdle(bear.id, tick, players);
        break;
      case "aggro":
        this.bearAggro(bear.id, tick);
        break;
      case "attacking":
        this.bearAttacking(bear.id, tick);
        break;
    }
  }

  private bearIdle(bearId: string, tick: number, players: { x: number; y: number; id: string }[]): void {
    const bear = this.entities.get(bearId);
    if (!bear) return;

    // Check for aggro
    for (const p of players) {
      const dist = Math.abs(p.x - bear.position.x) + Math.abs(p.y - bear.position.y);
      if (dist <= BEAR_AGGRO_RADIUS) {
        this.entities.updateProperty(bearId, "state", "aggro");
        this.entities.updateProperty(bearId, "targetPlayerId", p.id);
        return;
      }
    }

    // Wander randomly
    const lastMove = (bear.properties.lastMoveTick as number) ?? 0;
    if (tick - lastMove >= BEAR_WANDER_INTERVAL) {
      this.bearWander(bearId, tick);
    }
  }

  private bearAggro(bearId: string, tick: number): void {
    const bear = this.entities.get(bearId);
    if (!bear) return;

    const targetId = bear.properties.targetPlayerId as string;
    const target = this.game.getPlayer(targetId);

    // Lost target — go idle
    if (!target) {
      this.entities.updateProperty(bearId, "state", "idle");
      this.entities.updateProperty(bearId, "targetPlayerId", "");
      return;
    }

    const dist = Math.abs(target.x - bear.position.x) + Math.abs(target.y - bear.position.y);

    // Target escaped — deaggro
    if (dist > BEAR_AGGRO_RADIUS * 2) {
      this.entities.updateProperty(bearId, "state", "idle");
      this.entities.updateProperty(bearId, "targetPlayerId", "");
      return;
    }

    // In attack range — transition to attacking
    if (dist <= BEAR_ATTACK_RANGE + 1) {
      this.entities.updateProperty(bearId, "state", "attacking");
      return;
    }

    // Chase: greedy move toward target (one tile per wander interval)
    const lastMove = (bear.properties.lastMoveTick as number) ?? 0;
    if (tick - lastMove >= BEAR_WANDER_INTERVAL) {
      this.bearChase(bearId, target, tick);
    }
  }

  private bearAttacking(bearId: string, tick: number): void {
    const bear = this.entities.get(bearId);
    if (!bear) return;

    const targetId = bear.properties.targetPlayerId as string;
    const target = this.game.getPlayer(targetId);

    // Lost target
    if (!target) {
      this.entities.updateProperty(bearId, "state", "idle");
      this.entities.updateProperty(bearId, "targetPlayerId", "");
      return;
    }

    const dist = Math.abs(target.x - bear.position.x) + Math.abs(target.y - bear.position.y);

    // Target moved out of range
    if (dist > BEAR_ATTACK_RANGE + 1) {
      this.entities.updateProperty(bearId, "state", "aggro");
      return;
    }

    // Attack on cooldown
    const lastAttack = (bear.properties.lastAttackTick as number) ?? -Infinity;
    if (tick - lastAttack < BEAR_ATTACK_COOLDOWN) return;

    this.entities.updateProperty(bearId, "lastAttackTick", tick);

    // Deal damage to player
    const maxHp = target.maxHp ?? PLAYER_DEFAULT_HP;
    const currentHp = target.hp ?? maxHp;
    const newHp = Math.max(0, currentHp - BEAR_DAMAGE);
    target.hp = newHp;

    this.emitEvent(tick, "bear_attack", undefined, {
      bearId,
      playerId: targetId,
      damage: BEAR_DAMAGE,
      playerHp: newHp,
    });

    this.emitEvent(tick, "player_damage", targetId, {
      source: bearId,
      damage: BEAR_DAMAGE,
      hp: newHp,
    });

    // Player death
    if (newHp <= 0) {
      this.handlePlayerDeath(targetId, tick);
      this.entities.updateProperty(bearId, "state", "idle");
      this.entities.updateProperty(bearId, "targetPlayerId", "");
    }
  }

  // ---------------------------------------------------------------------------
  // Movement helpers
  // ---------------------------------------------------------------------------

  private bearWander(bearId: string, tick: number): void {
    const bear = this.entities.get(bearId);
    if (!bear) return;

    const neighbors = this.game.world.getNeighbors(bear.position);
    if (neighbors.length === 0) return;

    const target = neighbors[this.game.rng.nextInt(neighbors.length)];
    bear.position.x = target.x;
    bear.position.y = target.y;
    this.entities.updateProperty(bearId, "lastMoveTick", tick);
  }

  private bearChase(bearId: string, target: { x: number; y: number }, tick: number): void {
    const bear = this.entities.get(bearId);
    if (!bear) return;

    // Pick the walkable neighbor closest to the target (greedy)
    const neighbors = this.game.world.getNeighbors(bear.position);
    if (neighbors.length === 0) return;

    let best = neighbors[0];
    let bestDist = Math.abs(best.x - target.x) + Math.abs(best.y - target.y);
    for (let i = 1; i < neighbors.length; i++) {
      const d = Math.abs(neighbors[i].x - target.x) + Math.abs(neighbors[i].y - target.y);
      if (d < bestDist) {
        best = neighbors[i];
        bestDist = d;
      }
    }

    bear.position.x = best.x;
    bear.position.y = best.y;
    this.entities.updateProperty(bearId, "lastMoveTick", tick);
  }

  // ---------------------------------------------------------------------------
  // Player death / respawn
  // ---------------------------------------------------------------------------

  private handlePlayerDeath(playerId: string, tick: number): void {
    const player = this.game.getPlayer(playerId);
    if (!player) return;

    this.emitEvent(tick, "player_death", playerId, {});

    // Respawn at a random spawn point with full HP
    const spawns = this.game.world.getSpawnPoints();
    const spawn = spawns[this.game.rng.nextInt(spawns.length)];
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = player.maxHp ?? PLAYER_DEFAULT_HP;
    player.state = "idle";
    player.path = undefined;
    player.targetX = undefined;
    player.targetY = undefined;
    player.vx = 0;
    player.vy = 0;
    player.inputX = 0;
    player.inputY = 0;
  }

  // ---------------------------------------------------------------------------
  // Bear lifecycle
  // ---------------------------------------------------------------------------

  private spawnBear(position: Position, tick: number): string {
    const bear = this.entities.spawn("bear", position, {
      hp: BEAR_HP,
      maxHp: BEAR_HP,
      state: "idle" as string,
      targetPlayerId: "",
      lastMoveTick: tick,
      lastAttackTick: tick - BEAR_ATTACK_COOLDOWN,
      lonelinessTimer: 0,
      damage: BEAR_DAMAGE,
    });
    this.emitEvent(tick, "bear_spawn", undefined, {
      bearId: bear.id,
      x: position.x,
      y: position.y,
    });
    return bear.id;
  }

  private killBear(bearId: string, tick: number, reason: string): void {
    const bear = this.entities.get(bearId);
    if (!bear) return;

    // Drop bear meat at bear's position
    this.entities.spawn("bear_meat", { ...bear.position }, {
      droppedAtTick: tick,
    });
    this.emitEvent(tick, "item_drop", undefined, {
      item: "bear_meat",
      x: bear.position.x,
      y: bear.position.y,
    });

    this.emitEvent(tick, "bear_death", undefined, {
      bearId,
      reason,
      x: bear.position.x,
      y: bear.position.y,
    });

    this.entities.destroy(bearId);
  }

  private seedBear(tick: number): void {
    if (this.wildernessZones.length === 0) return;
    if (this.liveBearCount() >= BEAR_POPULATION_CAP) return;

    const players = this.game.getPlayers();
    const spawnPoints = this.game.world.getSpawnPoints();

    // Try up to 10 times to find a spot away from players AND spawn points
    for (let attempt = 0; attempt < 10; attempt++) {
      const pos = this.wildernessZones[this.game.rng.nextInt(this.wildernessZones.length)];
      const nearPlayer = players.some(
        (p) => Math.abs(p.x - pos.x) + Math.abs(p.y - pos.y) <= BEAR_SPAWN_PLAYER_BUFFER,
      );
      const nearSpawn = spawnPoints.some(
        (s) => Math.abs(s.x - pos.x) + Math.abs(s.y - pos.y) <= BEAR_SPAWN_PLAYER_BUFFER,
      );
      if (!nearPlayer && !nearSpawn) {
        this.spawnBear(pos, tick);
        return;
      }
    }

    // Fallback: spawn at any wilderness tile
    const pos = this.wildernessZones[this.game.rng.nextInt(this.wildernessZones.length)];
    this.spawnBear(pos, tick);
  }

  // ---------------------------------------------------------------------------
  // Game of Life automaton
  // ---------------------------------------------------------------------------

  evaluateGameOfLife(tick: number): void {
    const liveBears = this.entities.getByType("bear").filter(
      (b) => b.properties.state !== "dead",
    );

    const occupied = new Set(liveBears.map((b) => `${b.position.x},${b.position.y}`));

    // Phase 1: Deaths (overcrowding / loneliness)
    for (const bear of liveBears) {
      const neighbors = this.countChebyshevNeighbors(bear.position, liveBears);

      if (neighbors > GOL_SURVIVAL_MAX) {
        // Overcrowding — despawn
        this.emitEvent(tick, "bear_death", undefined, {
          bearId: bear.id,
          reason: "overcrowding",
          x: bear.position.x,
          y: bear.position.y,
        });
        this.entities.destroy(bear.id);
      } else if (neighbors < GOL_SURVIVAL_MIN) {
        // Isolation — increment loneliness timer
        const timer = ((bear.properties.lonelinessTimer as number) ?? 0) + GOL_EVAL_INTERVAL;
        if (timer >= GOL_LONELINESS_TICKS) {
          this.emitEvent(tick, "bear_death", undefined, {
            bearId: bear.id,
            reason: "loneliness",
            x: bear.position.x,
            y: bear.position.y,
          });
          this.entities.destroy(bear.id);
        } else {
          this.entities.updateProperty(bear.id, "lonelinessTimer", timer);
        }
      } else {
        // Has neighbors — reset loneliness
        this.entities.updateProperty(bear.id, "lonelinessTimer", 0);
      }
    }

    // Phase 2: Births
    if (this.liveBearCount() >= BEAR_POPULATION_CAP) return;

    // Refresh live bears after deaths
    const aliveBears = this.entities.getByType("bear").filter(
      (b) => b.properties.state !== "dead",
    );
    const players = this.game.getPlayers();
    const spawnPoints = this.game.world.getSpawnPoints();

    // Shuffle wilderness zones for fairness (using seeded RNG)
    const candidates = this.game.rng.shuffle([...this.wildernessZones]);

    for (const pos of candidates) {
      if (this.liveBearCount() >= BEAR_POPULATION_CAP) break;

      const key = `${pos.x},${pos.y}`;
      if (occupied.has(key)) continue;

      // Don't spawn near players or spawn points
      const nearPlayer = players.some(
        (p) => Math.abs(p.x - pos.x) + Math.abs(p.y - pos.y) <= BEAR_SPAWN_PLAYER_BUFFER,
      );
      const nearSpawn = spawnPoints.some(
        (s) => Math.abs(s.x - pos.x) + Math.abs(s.y - pos.y) <= BEAR_SPAWN_PLAYER_BUFFER,
      );
      if (nearPlayer || nearSpawn) continue;

      const neighbors = this.countChebyshevNeighbors(pos, aliveBears);
      if (neighbors >= GOL_BIRTH_MIN && neighbors <= GOL_BIRTH_MAX) {
        this.spawnBear(pos, tick);
      }
    }
  }

  /** Count bears within Chebyshev distance (Moore neighborhood), excluding the tile itself. */
  private countChebyshevNeighbors(
    pos: Position,
    bears: { position: Position }[],
  ): number {
    let count = 0;
    for (const b of bears) {
      if (b.position.x === pos.x && b.position.y === pos.y) continue;
      const dist = Math.max(
        Math.abs(b.position.x - pos.x),
        Math.abs(b.position.y - pos.y),
      );
      if (dist <= GOL_NEIGHBORHOOD_RADIUS) count++;
    }
    return count;
  }

  // ---------------------------------------------------------------------------
  // Wilderness zone computation
  // ---------------------------------------------------------------------------

  private computeWildernessZones(): Position[] {
    const world = this.game.world;
    const activities = world.getActivities();
    const spawns = world.getSpawnPoints();
    const spawnSet = new Set(spawns.map((p) => `${p.x},${p.y}`));
    const zones: Position[] = [];

    for (let y = 0; y < world.height; y++) {
      for (let x = 0; x < world.width; x++) {
        if (!world.isWalkable(x, y)) continue;
        if (spawnSet.has(`${x},${y}`)) continue;

        // Exclude tiles near activities
        const nearActivity = activities.some(
          (a) => Math.abs(a.x - x) + Math.abs(a.y - y) <= WILDERNESS_ACTIVITY_BUFFER,
        );
        if (nearActivity) continue;

        zones.push({ x, y });
      }
    }
    return zones;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private liveBearCount(): number {
    return this.entities.getByType("bear").filter((b) => b.properties.state !== "dead").length;
  }

  /** Find the nearest pickupable entity to a player (bear_meat or ground_item). */
  findNearestPickupable(playerId: string): string | undefined {
    const player = this.game.getPlayer(playerId);
    if (!player) return undefined;

    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    const candidates = [
      ...this.entities.getNearby(pos, 1, "bear_meat"),
      ...this.entities.getNearby(pos, 1, "ground_item"),
    ];

    if (candidates.length === 0) return undefined;

    // Return the closest one
    let best = candidates[0];
    let bestDist = Math.abs(best.position.x - player.x) + Math.abs(best.position.y - player.y);
    for (let i = 1; i < candidates.length; i++) {
      const d = Math.abs(candidates[i].position.x - player.x) + Math.abs(candidates[i].position.y - player.y);
      if (d < bestDist) {
        best = candidates[i];
        bestDist = d;
      }
    }
    return best.id;
  }

  /** Get inventory as a plain object for serialization. */
  getInventoryItems(playerId: string): Record<string, number> {
    const inv = this.getInventory(playerId);
    const items: Record<string, number> = {};
    for (const [key, count] of inv) {
      items[key] = count;
    }
    return items;
  }

  /** Get inventory capacity. */
  getInventoryCapacity(): number {
    return PLAYER_INVENTORY_CAPACITY;
  }

  private emitEvent(
    tick: number,
    type: GameEvent["type"],
    playerId: string | undefined,
    data: Record<string, unknown>,
  ): void {
    this.pendingEvents.push({ tick, type, playerId, data });
  }
}
