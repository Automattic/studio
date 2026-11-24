import { createPendingSlot } from '@/lib/pending-slot';

// Text another screen hands to a composer, which takes it as its draft: the one with this
// draft key, whether it is on screen already or shows next.
export const pendingComposerDraftSlot = createPendingSlot< { draftKey: string; text: string } >();
