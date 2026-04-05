/**
 * Item catalog — defines all item types in the game.
 *
 * Items are identified by string IDs. Each definition describes display
 * properties and stacking behavior. The catalog is the single source of
 * truth for item metadata used by inventory helpers and the client UI.
 */

export interface ItemDef {
  id: string;
  name: string;
  emoji: string;
  maxStack: number;
}

const ITEMS: ItemDef[] = [
  { id: "raw_food", name: "Berries", emoji: "\uD83E\uDED0", maxStack: 99 },
  { id: "cooked_food", name: "Cooked Food", emoji: "\uD83C\uDF72", maxStack: 99 },
  { id: "bear_meat", name: "Bear Meat", emoji: "\uD83E\uDD69", maxStack: 99 },
];

const ITEM_MAP = new Map<string, ItemDef>(ITEMS.map((item) => [item.id, item]));

export function getItemDef(id: string): ItemDef | undefined {
  return ITEM_MAP.get(id);
}

export function getAllItems(): readonly ItemDef[] {
  return ITEMS;
}
