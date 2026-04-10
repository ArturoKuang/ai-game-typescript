import type { EntityManager } from "../autonomy/entityManager.js";
import {
  addItem,
  createInventory,
  hasItem,
  removeItem,
} from "../autonomy/inventory.js";
import type { NpcInventory, WorldEntity } from "../autonomy/types.js";
import { snapshotConversation } from "../engine/conversation.js";
/**
 * Bear and combat system — bear AI, player attacks, loot, and GoL spawning.
 *
 * Bears are WorldEntities managed by the EntityManager. The BearManager
 * hooks into GameLoop.onAfterTick to run bear AI, process combat commands,
 * and evaluate the GoL cellular automaton for population control.
 */
import type { GameLoop } from "../engine/gameLoop.js";
import { manhattanDistance } from "../engine/spatial.js";
import type { GameEvent, Player, Position } from "../engine/types.js";
import {
  BEAR_AGGRO_RADIUS,
  BEAR_ATTACK_COOLDOWN,
  BEAR_ATTACK_RANGE,
  BEAR_DAMAGE,
  BEAR_HP,
  BEAR_INITIAL_COUNT,
  BEAR_MEAT_HEAL,
  BEAR_POPULATION_CAP,
  BEAR_POPULATION_MIN,
  BEAR_SPAWN_PLAYER_BUFFER,
  BEAR_WANDER_INTERVAL,
  GOL_BIRTH_MAX,
  GOL_BIRTH_MIN,
  GOL_EVAL_INTERVAL,
  GOL_LONELINESS_TICKS,
  GOL_NEIGHBORHOOD_RADIUS,
  GOL_SURVIVAL_MAX,
  GOL_SURVIVAL_MIN,
  PLAYER_ATTACK_COOLDOWN,
  PLAYER_ATTACK_DAMAGE,
  PLAYER_ATTACK_RANGE,
  PLAYER_DEFAULT_HP,
  PLAYER_INVENTORY_CAPACITY,
  WILDERNESS_ACTIVITY_BUFFER,
} from "./bearConfig.js";

export type BearState = "idle" | "aggro" | "attacking" | "dead";

export type BearCommand =
  | { type: "attack"; playerId: string; data: { targetId: string } }
  | { type: "pickup"; playerId: string; data: { entityId: string } }
  | { type: "eat"; playerId: string; data: { item: string } };

type CombatPlayer = Pick<Player, "id" | "x" | "y" | "hp" | "maxHp">;

interface PickupResolution {
  itemId: string;
  quantity: number;
}

const CONSUMABLE_ITEMS = ["bear_meat", "raw_food", "cooked_food"] as const;
type ConsumableItem = (typeof CONSUMABLE_ITEMS)[number];

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
    this.registerCommandForwarders();
    this.game.onAfterTick((result) => this.update(result.tick));
  }

  /** Seed initial bear population at boot. */
  seedInitialBears(): void {
    for (
      let i = 0;
      i < BEAR_INITIAL_COUNT && i < this.wildernessZones.length;
      i++
    ) {
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
    for (const bear of this.getLiveBears()) {
      this.updateBearAI(bear.id, tick);
    }

    // 3. Let nearby NPCs opportunistically attack nearby combat targets.
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
      this.processCommand(cmd, tick);
    }
  }

  private handlePlayerAttack(
    playerId: string,
    targetId: string,
    tick: number,
  ): void {
    const attacker = this.getLivingPlayer(playerId);
    if (!attacker || targetId === playerId) {
      return;
    }

    const targetPlayer = this.game.getPlayer(targetId);
    if (targetPlayer) {
      this.handlePlayerVsPlayerAttack(attacker, targetPlayer, tick);
      return;
    }

    const bear = this.entities.get(targetId);
    if (!this.isActiveBear(bear)) {
      return;
    }

    this.handlePlayerVsBearAttack(attacker, bear.id, tick);
  }

  private handlePlayerVsPlayerAttack(
    attacker: CombatPlayer,
    target: CombatPlayer,
    tick: number,
  ): void {
    if (!this.isAlive(target)) {
      return;
    }

    if (!this.tryBeginPlayerAttack(attacker.id, attacker, target, tick)) {
      return;
    }

    const { hp: newHp } = this.applyDamageToPlayer(
      target,
      PLAYER_ATTACK_DAMAGE,
    );

    this.emitEvent(tick, "player_attack", attacker.id, {
      targetId: target.id,
      targetPlayerId: target.id,
      targetType: "player",
      damage: PLAYER_ATTACK_DAMAGE,
      targetHp: newHp,
    });

    this.emitEvent(tick, "player_damage", target.id, {
      source: attacker.id,
      sourceType: "player",
      damage: PLAYER_ATTACK_DAMAGE,
      hp: newHp,
    });

    if (newHp <= 0) {
      this.handlePlayerDeath(target.id, tick, {
        cause: "combat",
        source: attacker.id,
        killerId: attacker.id,
      });
    }
  }

  private handlePlayerVsBearAttack(
    attacker: CombatPlayer,
    bearId: string,
    tick: number,
  ): void {
    const bear = this.entities.get(bearId);
    if (!this.isActiveBear(bear)) {
      return;
    }

    if (
      !this.tryBeginPlayerAttack(attacker.id, attacker, bear.position, tick)
    ) {
      return;
    }

    const newHp = Math.max(
      0,
      (bear.properties.hp as number) - PLAYER_ATTACK_DAMAGE,
    );
    this.entities.updateProperty(bearId, "hp", newHp);

    this.emitEvent(tick, "player_attack", attacker.id, {
      targetId: bearId,
      bearId,
      targetType: "bear",
      damage: PLAYER_ATTACK_DAMAGE,
      bearHp: newHp,
      targetHp: newHp,
    });

    if (newHp <= 0) {
      this.killBear(bearId, tick, "killed");
    }
  }

  private handlePickup(playerId: string, entityId: string, tick: number): void {
    const player = this.game.getPlayer(playerId);
    if (!player) return;

    const entity = this.entities.get(entityId);
    if (!entity || entity.destroyed) return;

    const pickup = this.resolvePickupEntity(entity);
    if (!pickup) return;
    if (!this.isWithinRange(player, entity.position, 1.5)) return;
    if (!this.canAddInventoryItem(playerId, pickup.itemId)) return;

    // Add to inventory and destroy ground entity
    addItem(this.getInventory(playerId), pickup.itemId, pickup.quantity);
    this.entities.destroy(entityId);

    this.emitEvent(tick, "item_pickup", playerId, {
      item: pickup.itemId,
      quantity: pickup.quantity,
      entityId,
    });
  }

  private handleEat(playerId: string, item: string, tick: number): void {
    if (!this.isConsumableItem(item)) return;

    const player = this.game.getPlayer(playerId);
    if (!player) return;

    const inv = this.getInventory(playerId);
    if (!hasItem(inv, item)) return;

    removeItem(inv, item);

    if (item === "bear_meat") {
      const {
        hp: newHp,
        maxHp,
        change,
      } = this.healPlayer(player, BEAR_MEAT_HEAL);

      this.emitEvent(tick, "player_heal", playerId, {
        item: "bear_meat",
        healAmount: change,
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
      if (!player.isNpc || !this.isAlive(player)) continue;
      if (this.game.conversations.getPlayerConversation(player.id)) continue;

      const targetId = this.findAutomaticNpcTarget(player.id);
      if (!targetId) continue;
      this.handlePlayerAttack(player.id, targetId, tick);
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

  private bearIdle(
    bearId: string,
    tick: number,
    players: { x: number; y: number; id: string }[],
  ): void {
    const bear = this.entities.get(bearId);
    if (!bear) return;

    // Check for aggro
    for (const p of players) {
      if (this.isWithinRange(p, bear.position, BEAR_AGGRO_RADIUS)) {
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

    const target = this.getBearTarget(bear);

    // Lost target — go idle
    if (!target) {
      this.clearBearTarget(bearId);
      return;
    }

    const dist = manhattanDistance(target.player, bear.position);

    // Target escaped — deaggro
    if (dist > BEAR_AGGRO_RADIUS * 2) {
      this.clearBearTarget(bearId);
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
      this.bearChase(bearId, target.player, tick);
    }
  }

  private bearAttacking(bearId: string, tick: number): void {
    const bear = this.entities.get(bearId);
    if (!bear) return;

    const target = this.getBearTarget(bear);

    // Lost target
    if (!target) {
      this.clearBearTarget(bearId);
      return;
    }

    const dist = manhattanDistance(target.player, bear.position);

    // Target moved out of range
    if (dist > BEAR_ATTACK_RANGE + 1) {
      this.entities.updateProperty(bearId, "state", "aggro");
      return;
    }

    // Attack on cooldown
    const lastAttack =
      (bear.properties.lastAttackTick as number) ?? Number.NEGATIVE_INFINITY;
    if (tick - lastAttack < BEAR_ATTACK_COOLDOWN) return;

    this.entities.updateProperty(bearId, "lastAttackTick", tick);

    // Deal damage to player
    const { hp: newHp } = this.applyDamageToPlayer(target.player, BEAR_DAMAGE);

    this.emitEvent(tick, "bear_attack", undefined, {
      bearId,
      playerId: target.playerId,
      damage: BEAR_DAMAGE,
      playerHp: newHp,
    });

    this.emitEvent(tick, "player_damage", target.playerId, {
      source: bearId,
      damage: BEAR_DAMAGE,
      hp: newHp,
    });

    // Player death
    if (newHp <= 0) {
      this.handlePlayerDeath(target.playerId, tick);
      this.clearBearTarget(bearId);
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

  private bearChase(
    bearId: string,
    target: { x: number; y: number },
    tick: number,
  ): void {
    const bear = this.entities.get(bearId);
    if (!bear) return;

    // Pick the walkable neighbor closest to the target (greedy)
    const neighbors = this.game.world.getNeighbors(bear.position);
    if (neighbors.length === 0) return;

    let best = neighbors[0];
    let bestDist = manhattanDistance(best, target);
    for (let i = 1; i < neighbors.length; i++) {
      const d = manhattanDistance(neighbors[i], target);
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

  private handlePlayerDeath(
    playerId: string,
    tick: number,
    data: Record<string, unknown> = {},
  ): void {
    const player = this.game.getPlayer(playerId);
    if (!player) return;

    const conversation =
      this.game.conversations.getPlayerConversation(playerId);
    if (conversation && conversation.state !== "ended") {
      const ended = this.game.conversations.endConversation(
        conversation.id,
        tick,
        "missing_player",
      );
      this.emitEvent(tick, "convo_ended", playerId, {
        convoId: ended.id,
        reason: ended.endedReason,
        participantIds: [ended.player1Id, ended.player2Id],
        conversation: snapshotConversation(ended),
      });
    }

    this.emitEvent(tick, "player_death", playerId, data);
    this.respawnPlayer(player);
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
    this.emitBearSpawn(tick, bear.id, position);
    return bear.id;
  }

  private killBear(bearId: string, tick: number, reason: string): void {
    const bear = this.entities.get(bearId);
    if (!bear) return;

    this.dropBearMeat(tick, bear.position);
    this.despawnBear(bearId, tick, reason, bear.position);
  }

  private seedBear(tick: number): void {
    if (this.wildernessZones.length === 0) return;
    if (this.liveBearCount() >= BEAR_POPULATION_CAP) return;

    const players = this.game.getPlayers();
    const spawnPoints = this.game.world.getSpawnPoints();

    // Try up to 10 times to find a spot away from players AND spawn points
    for (let attempt = 0; attempt < 10; attempt++) {
      const pos =
        this.wildernessZones[
          this.game.rng.nextInt(this.wildernessZones.length)
        ];
      if (!this.isBlockedBearSpawnPosition(pos, players, spawnPoints)) {
        this.spawnBear(pos, tick);
        return;
      }
    }

    // Fallback: spawn at any wilderness tile
    const pos =
      this.wildernessZones[this.game.rng.nextInt(this.wildernessZones.length)];
    this.spawnBear(pos, tick);
  }

  // ---------------------------------------------------------------------------
  // Game of Life automaton
  // ---------------------------------------------------------------------------

  evaluateGameOfLife(tick: number): void {
    const liveBears = this.getLiveBears();
    const occupied = new Set(
      liveBears.map((bear) => this.positionKey(bear.position)),
    );

    this.processGameOfLifeDeaths(tick, liveBears);

    // Phase 2: Births
    if (this.liveBearCount() >= BEAR_POPULATION_CAP) return;

    // Refresh live bears after deaths
    this.processGameOfLifeBirths(tick, occupied);
  }

  /** Count bears within Chebyshev distance (Moore neighborhood), excluding the tile itself. */
  private countChebyshevNeighbors(
    pos: Position,
    bears: readonly { position: Position }[],
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
        const nearActivity = this.isNearAnyPosition(
          { x, y },
          activities,
          WILDERNESS_ACTIVITY_BUFFER,
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
    return this.getLiveBears().length;
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
    let bestDist = manhattanDistance(best.position, player);
    for (let i = 1; i < candidates.length; i++) {
      const d = manhattanDistance(candidates[i].position, player);
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

  private isAlive(player: { hp?: number; maxHp?: number }): boolean {
    return (player.hp ?? player.maxHp ?? PLAYER_DEFAULT_HP) > 0;
  }

  private tryBeginPlayerAttack(
    playerId: string,
    attacker: { x: number; y: number },
    target: Position,
    tick: number,
  ): boolean {
    if (!this.isWithinRange(attacker, target, PLAYER_ATTACK_RANGE + 1)) {
      return false;
    }

    const lastAttack =
      this.playerAttackCooldowns.get(playerId) ?? Number.NEGATIVE_INFINITY;
    if (tick - lastAttack < PLAYER_ATTACK_COOLDOWN) {
      return false;
    }

    this.playerAttackCooldowns.set(playerId, tick);
    return true;
  }

  private findAutomaticNpcTarget(playerId: string): string | undefined {
    const attacker = this.game.getPlayer(playerId);
    if (!attacker) {
      return undefined;
    }

    const nearbyPlayers = this.game
      .getPlayers()
      .filter((other) => {
        if (other.id === playerId || !this.isAlive(other)) {
          return false;
        }
        const dist = manhattanDistance(other, attacker);
        return dist <= PLAYER_ATTACK_RANGE + 1;
      })
      .sort((left, right) => {
        const leftDist = manhattanDistance(left, attacker);
        const rightDist = manhattanDistance(right, attacker);
        return leftDist - rightDist;
      });

    if (nearbyPlayers.length > 0) {
      return nearbyPlayers[0].id;
    }

    const pos = { x: Math.round(attacker.x), y: Math.round(attacker.y) };
    return this.entities
      .getNearby(pos, PLAYER_ATTACK_RANGE + 1, "bear")
      .find(
        (bear) =>
          bear.properties.state === "aggro" ||
          bear.properties.state === "attacking",
      )?.id;
  }

  private emitEvent(
    tick: number,
    type: GameEvent["type"],
    playerId: string | undefined,
    data: Record<string, unknown>,
  ): void {
    this.pendingEvents.push({ tick, type, playerId, data });
  }

  private registerCommandForwarders(): void {
    this.game.onCommand("attack", (cmd) => {
      this.enqueue({
        type: "attack",
        playerId: cmd.playerId,
        data: { targetId: cmd.data.targetId },
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
  }

  private processCommand(cmd: BearCommand, tick: number): void {
    switch (cmd.type) {
      case "attack":
        this.handlePlayerAttack(cmd.playerId, cmd.data.targetId, tick);
        return;
      case "pickup":
        this.handlePickup(cmd.playerId, cmd.data.entityId, tick);
        return;
      case "eat":
        this.handleEat(cmd.playerId, cmd.data.item, tick);
        return;
    }
  }

  private getLivingPlayer(playerId: string): Player | undefined {
    const player = this.game.getPlayer(playerId);
    return player && this.isAlive(player) ? player : undefined;
  }

  private getLiveBears(): WorldEntity[] {
    return this.entities
      .getByType("bear")
      .filter((bear) => this.isActiveBear(bear));
  }

  private isActiveBear(bear: WorldEntity | undefined): bear is WorldEntity {
    return (
      !!bear &&
      !bear.destroyed &&
      bear.type === "bear" &&
      bear.properties.state !== "dead"
    );
  }

  private resolvePickupEntity(entity: WorldEntity): PickupResolution | null {
    if (entity.type === "bear_meat") {
      return { itemId: "bear_meat", quantity: 1 };
    }
    if (entity.type !== "ground_item") {
      return null;
    }
    const itemId = entity.properties.itemId as string | undefined;
    if (!itemId) {
      return null;
    }
    return {
      itemId,
      quantity: (entity.properties.quantity as number) ?? 1,
    };
  }

  private getBearTarget(
    bear: WorldEntity,
  ): { playerId: string; player: Player } | null {
    const playerId = bear.properties.targetPlayerId as string | undefined;
    if (!playerId) {
      return null;
    }
    const player = this.game.getPlayer(playerId);
    if (!player) {
      return null;
    }
    return { playerId, player };
  }

  private clearBearTarget(bearId: string): void {
    this.entities.updateProperty(bearId, "state", "idle");
    this.entities.updateProperty(bearId, "targetPlayerId", "");
  }

  private canAddInventoryItem(playerId: string, itemId: string): boolean {
    const inv = this.getInventory(playerId);
    return inv.size < PLAYER_INVENTORY_CAPACITY || inv.has(itemId);
  }

  private isConsumableItem(item: string): item is ConsumableItem {
    return (CONSUMABLE_ITEMS as readonly string[]).includes(item);
  }

  private applyDamageToPlayer(
    player: CombatPlayer,
    damage: number,
  ): { hp: number; maxHp: number } {
    const maxHp = player.maxHp ?? PLAYER_DEFAULT_HP;
    const currentHp = player.hp ?? maxHp;
    const hp = Math.max(0, currentHp - damage);
    player.hp = hp;
    return { hp, maxHp };
  }

  private healPlayer(
    player: CombatPlayer,
    amount: number,
  ): { hp: number; maxHp: number; change: number } {
    const maxHp = player.maxHp ?? PLAYER_DEFAULT_HP;
    const currentHp = player.hp ?? maxHp;
    const hp = Math.min(maxHp, currentHp + amount);
    player.hp = hp;
    return { hp, maxHp, change: hp - currentHp };
  }

  private isWithinRange(
    left: Position,
    right: Position,
    range: number,
  ): boolean {
    return manhattanDistance(left, right) <= range;
  }

  private isNearAnyPosition(
    position: Position,
    candidates: readonly Position[],
    range: number,
  ): boolean {
    return candidates.some((candidate) =>
      this.isWithinRange(position, candidate, range),
    );
  }

  private isBlockedBearSpawnPosition(
    position: Position,
    players: readonly Position[],
    spawnPoints: readonly Position[],
  ): boolean {
    return (
      this.isNearAnyPosition(position, players, BEAR_SPAWN_PLAYER_BUFFER) ||
      this.isNearAnyPosition(position, spawnPoints, BEAR_SPAWN_PLAYER_BUFFER)
    );
  }

  private respawnPlayer(player: Player): void {
    const spawn = this.getRandomSpawnPoint();
    player.x = spawn.x;
    player.y = spawn.y;
    player.hp = player.maxHp ?? PLAYER_DEFAULT_HP;
    player.state = "idle";
    player.currentConvoId = undefined;
    player.isWaitingForResponse = false;
    player.path = undefined;
    player.targetX = undefined;
    player.targetY = undefined;
    player.vx = 0;
    player.vy = 0;
    player.inputX = 0;
    player.inputY = 0;
  }

  private getRandomSpawnPoint(): Position {
    const spawns = this.game.world.getSpawnPoints();
    return spawns[this.game.rng.nextInt(spawns.length)];
  }

  private emitBearSpawn(
    tick: number,
    bearId: string,
    position: Position,
  ): void {
    this.emitEvent(tick, "bear_spawn", undefined, {
      bearId,
      x: position.x,
      y: position.y,
    });
  }

  private dropBearMeat(tick: number, position: Position): void {
    this.entities.spawn(
      "bear_meat",
      { ...position },
      {
        droppedAtTick: tick,
      },
    );
    this.emitEvent(tick, "item_drop", undefined, {
      item: "bear_meat",
      x: position.x,
      y: position.y,
    });
  }

  private despawnBear(
    bearId: string,
    tick: number,
    reason: string,
    position: Position,
  ): void {
    this.emitEvent(tick, "bear_death", undefined, {
      bearId,
      reason,
      x: position.x,
      y: position.y,
    });
    this.entities.destroy(bearId);
  }

  private processGameOfLifeDeaths(
    tick: number,
    liveBears: readonly WorldEntity[],
  ): void {
    for (const bear of liveBears) {
      const neighbors = this.countChebyshevNeighbors(bear.position, liveBears);

      if (neighbors > GOL_SURVIVAL_MAX) {
        this.despawnBear(bear.id, tick, "overcrowding", bear.position);
        continue;
      }

      if (neighbors < GOL_SURVIVAL_MIN) {
        const timer =
          ((bear.properties.lonelinessTimer as number) ?? 0) +
          GOL_EVAL_INTERVAL;
        if (timer >= GOL_LONELINESS_TICKS) {
          this.despawnBear(bear.id, tick, "loneliness", bear.position);
        } else {
          this.entities.updateProperty(bear.id, "lonelinessTimer", timer);
        }
        continue;
      }

      this.entities.updateProperty(bear.id, "lonelinessTimer", 0);
    }
  }

  private processGameOfLifeBirths(
    tick: number,
    occupied: ReadonlySet<string>,
  ): void {
    const aliveBears = this.getLiveBears();
    const players = this.game.getPlayers();
    const spawnPoints = this.game.world.getSpawnPoints();
    const candidates = this.game.rng.shuffle([...this.wildernessZones]);

    for (const pos of candidates) {
      if (this.liveBearCount() >= BEAR_POPULATION_CAP) {
        return;
      }
      if (occupied.has(this.positionKey(pos))) {
        continue;
      }
      if (this.isBlockedBearSpawnPosition(pos, players, spawnPoints)) {
        continue;
      }

      const neighbors = this.countChebyshevNeighbors(pos, aliveBears);
      if (neighbors >= GOL_BIRTH_MIN && neighbors <= GOL_BIRTH_MAX) {
        this.spawnBear(pos, tick);
      }
    }
  }

  private positionKey(position: Position): string {
    return `${position.x},${position.y}`;
  }
}
