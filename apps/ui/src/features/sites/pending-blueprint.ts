import { createPendingSlot } from '@/lib/pending-slot';
import type { SelectedBlueprint } from '@/lib/blueprint-selection';

export const pendingBlueprintSlot = createPendingSlot< SelectedBlueprint >();
