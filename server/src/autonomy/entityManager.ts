/**
 * Manages dynamic world entities (berry bushes, benches, etc.)
 * that live in the autonomy layer, not the core engine.
 */
import type { Position } from "../engine/types.js";
import type {
  EntityManagerInterface,
  PredicateValue,
  WorldEntity,
} from "./types.js";

let nextEntityId = 1;

export class EntityManager implements EntityManagerInterface {
  private entities: Map<string, WorldEntity> = new Map();
  private listeners: Array<
    (event: "update" | "removed", entity: WorldEntity) => void
  > = [];

  spawn(
    type: string,
    position: Position,
    properties: Record<string, PredicateValue> = {},
  ): WorldEntity {
    const id = `entity_${nextEntityId++}`;
    const entity: WorldEntity = {
      id,
      type,
      position: { ...position },
      properties: { ...properties },
      destroyed: false,
    };
    this.entities.set(id, entity);
    this.notify("update", entity);
    return entity;
  }

  destroy(id: string): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    entity.destroyed = true;
    this.notify("removed", entity);
    this.entities.delete(id);
  }

  get(id: string): WorldEntity | undefined {
    return this.entities.get(id);
  }

  getByType(type: string): WorldEntity[] {
    const result: WorldEntity[] = [];
    for (const entity of this.entities.values()) {
      if (entity.type === type && !entity.destroyed) {
        result.push(entity);
      }
    }
    return result;
  }

  getAt(position: Position): WorldEntity[] {
    const result: WorldEntity[] = [];
    for (const entity of this.entities.values()) {
      if (
        !entity.destroyed &&
        entity.position.x === position.x &&
        entity.position.y === position.y
      ) {
        result.push(entity);
      }
    }
    return result;
  }

  getNearby(position: Position, radius: number, type?: string): WorldEntity[] {
    const result: WorldEntity[] = [];
    for (const entity of this.entities.values()) {
      if (entity.destroyed) continue;
      if (type && entity.type !== type) continue;
      const dist =
        Math.abs(entity.position.x - position.x) +
        Math.abs(entity.position.y - position.y);
      if (dist <= radius) {
        result.push(entity);
      }
    }
    return result.sort((a, b) => {
      const da =
        Math.abs(a.position.x - position.x) +
        Math.abs(a.position.y - position.y);
      const db =
        Math.abs(b.position.x - position.x) +
        Math.abs(b.position.y - position.y);
      return da - db;
    });
  }

  getAll(): WorldEntity[] {
    return Array.from(this.entities.values()).filter((e) => !e.destroyed);
  }

  /** Update a property on an entity and notify listeners. */
  updateProperty(id: string, key: string, value: PredicateValue): void {
    const entity = this.entities.get(id);
    if (!entity || entity.destroyed) return;
    entity.properties[key] = value;
    this.notify("update", entity);
  }

  onChange(
    listener: (event: "update" | "removed", entity: WorldEntity) => void,
  ): void {
    this.listeners.push(listener);
  }

  /** Load entities from map data format. */
  loadFromMapData(
    entities: Array<{
      type: string;
      x: number;
      y: number;
      properties?: Record<string, PredicateValue>;
    }>,
  ): void {
    for (const e of entities) {
      this.spawn(e.type, { x: e.x, y: e.y }, e.properties ?? {});
    }
  }

  private notify(event: "update" | "removed", entity: WorldEntity): void {
    for (const listener of this.listeners) {
      listener(event, entity);
    }
  }
}
