/**
 * Registers all built-in actions in the registry.
 */
import type { ActionRegistry } from "../registry.js";
import { cookAction } from "./cook.js";
import { eatAction, eatCookedAction } from "./eat.js";
import { exploreAction } from "./explore.js";
import { fleeAction } from "./flee.js";
import { gotoAction } from "./goto.js";
import { harvestAction } from "./harvest.js";
import { pickupAction } from "./pickup.js";
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
  registry.register(fleeAction);
  registry.register(pickupAction);
}
