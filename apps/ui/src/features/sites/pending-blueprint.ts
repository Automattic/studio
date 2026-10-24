import { createPendingSlot } from '@/lib/utils';
import type { SelectedBlueprint } from '@/features/sites/blueprint-selection';

export const pendingBlueprintSlot = createPendingSlot< SelectedBlueprint >();
