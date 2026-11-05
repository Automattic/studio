import { createPendingSlot } from '@/lib/pending-slot';
import type { SelectedSiteFolder } from '@/data/core';

export const pendingSiteFolderSlot = createPendingSlot< SelectedSiteFolder >();
