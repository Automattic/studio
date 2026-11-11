import { createPendingSlot } from '@/lib/pending-slot';

export const pendingComposerFilesSlot = createPendingSlot< { siteId: string; files: File[] } >();
