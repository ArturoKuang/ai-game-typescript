/**
 * Registers all built-in actions in the registry.
 */
import type { ActionRegistry } from "../registry.js";
import { attackBearAction } from "./attackBear.js";
import { cookAction } from "./cook.js";
import { drinkAction } from "./drink.js";
import { eatAction, eatCookedAction } from "./eat.js";
import { eatBearMeatAction } from "./eatBearMeat.js";
import { fleeAction } from "./flee.js";
import { gotoAction } from "./goto.js";
import { harvestAction } from "./harvest.js";
import { pickupAction } from "./pickup.js";
import { pickupBearMeatAction } from "./pickupBearMeat.js";
import { socializeAction } from "./socialize.js";
import { wanderAction } from "./wander.js";

export function registerBuiltinActions(registry: ActionRegistry): void {
  registry.register(gotoAction);
  registry.register(harvestAction);
  registry.register(attackBearAction);
  registry.register(cookAction);
  registry.register(drinkAction);
  registry.register(eatAction);
  registry.register(eatBearMeatAction);
  registry.register(eatCookedAction);
  registry.register(socializeAction);
  registry.register(fleeAction);
  registry.register(pickupAction);
  registry.register(pickupBearMeatAction);
  registry.register(wanderAction);
}
