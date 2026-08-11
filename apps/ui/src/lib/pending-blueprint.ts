import { createPendingSlot } from './pending-slot';
import type { SelectedBlueprint } from '@/lib/blueprint-selection';

/**
 * One-slot handoff for a blueprint that arrives from outside the create
 * route's own UI — currently the `wp-studio://add-site` deep link and the
 * File ▸ Open Blueprint menu item. The listener stores the blueprint here
 * and navigates to the create step; the route adopts it into component
 * state on arrival and clears the slot (identity-checked, so a newer
 * blueprint that arrived mid-adoption survives).
 */
const slot = createPendingSlot< SelectedBlueprint >();

export const pendingBlueprintSlot = {
	...slot,
	getSnapshot: slot.peek,
};

export const setPendingBlueprint = slot.set;
export const peekPendingBlueprint = slot.peek;
export const clearPendingBlueprint = slot.clear;
