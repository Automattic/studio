import { createPendingSlot } from '@/lib/pending-slot';

export const pendingBackupSlot = createPendingSlot< {
	path: string;
	name: string;
} >();
