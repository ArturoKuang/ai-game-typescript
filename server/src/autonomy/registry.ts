/**
 * Registry of GOAP action definitions.
 *
 * Actions are registered at boot time. The planner queries the registry
 * to find actions whose effects satisfy unmet goal predicates.
 */
import type { ActionDefinition, WorldState } from "./types.js";

export class ActionRegistry {
  private actions: Map<string, ActionDefinition> = new Map();

  register(action: ActionDefinition): void {
    this.actions.set(action.id, action);
  }

  get(id: string): ActionDefinition | undefined {
    return this.actions.get(id);
  }

  getAll(): ActionDefinition[] {
    return Array.from(this.actions.values());
  }

  /** Return actions whose effects overlap with the given predicates. */
  getActionsForEffects(predicates: WorldState): ActionDefinition[] {
    const result: ActionDefinition[] = [];
    for (const action of this.actions.values()) {
      for (const [key, value] of action.effects) {
        if (predicates.has(key) && predicates.get(key) === value) {
          result.push(action);
          break;
        }
      }
    }
    return result;
  }
}
