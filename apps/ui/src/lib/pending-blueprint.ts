import { createPendingSlot } from './pending-slot';
import type { PickedBlueprint } from '@/components/blueprint-selector';

/**
 * One-slot handoff for a blueprint that arrives from outside the blueprint
 * route's own UI — currently the `wp-studio://add-site` deep link. The
 * listener stores the blueprint here and navigates to the configure step;
 * the route adopts it into component state on arrival and clears the slot.
 */
export const pendingBlueprintSlot = createPendingSlot< PickedBlueprint >();

export const setPendingBlueprint = pendingBlueprintSlot.set;
export const peekPendingBlueprint = pendingBlueprintSlot.peek;
export const clearPendingBlueprint = pendingBlueprintSlot.clear;
