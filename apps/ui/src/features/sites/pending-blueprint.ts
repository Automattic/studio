import { createPendingSlot } from '@/lib/pending-slot';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';

export const pendingBlueprintSlot = createPendingSlot< SelectedBlueprint >();
