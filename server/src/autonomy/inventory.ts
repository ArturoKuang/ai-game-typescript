/**
 * Simple item-bag inventory for NPCs (item name -> count).
 */
import type { NpcInventory } from "./types.js";

export function createInventory(): NpcInventory {
  return new Map();
}

export function addItem(
  inv: NpcInventory,
  item: string,
  count = 1,
): void {
  inv.set(item, (inv.get(item) ?? 0) + count);
}

export function removeItem(
  inv: NpcInventory,
  item: string,
  count = 1,
): boolean {
  const current = inv.get(item) ?? 0;
  if (current < count) return false;
  const remaining = current - count;
  if (remaining === 0) {
    inv.delete(item);
  } else {
    inv.set(item, remaining);
  }
  return true;
}

export function hasItem(
  inv: NpcInventory,
  item: string,
  count = 1,
): boolean {
  return (inv.get(item) ?? 0) >= count;
}

export function getItemCount(inv: NpcInventory, item: string): number {
  return inv.get(item) ?? 0;
}
