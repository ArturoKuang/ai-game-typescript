/**
 * Registers all built-in actions in the registry.
 */
import { ActionRegistry } from "../registry.js";
import { cookAction } from "./cook.js";
import { eatAction } from "./eat.js";
import { eatCookedAction } from "./eat.js";
import { exploreAction } from "./explore.js";
import { gotoAction } from "./goto.js";
import { harvestAction } from "./harvest.js";
import { restAction } from "./rest.js";
import { socializeAction } from "./socialize.js";

export function registerBuiltinActions(registry: ActionRegistry): void {
  registry.register(gotoAction);
  registry.register(harvestAction);
  registry.register(cookAction);
  registry.register(eatAction);
  registry.register(eatCookedAction);
  registry.register(restAction);
  registry.register(socializeAction);
  registry.register(exploreAction);
}
