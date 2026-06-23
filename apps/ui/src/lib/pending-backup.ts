import { createPendingSlot } from './pending-slot';

/**
 * One-slot handoff for a backup archive picked outside the import route's
 * own UI — currently the drop-target card on the onboarding home screen.
 * The picker stores the file here and navigates to the configure step; the
 * route adopts it into component state on arrival and clears the slot.
 */

export interface PendingBackup {
	file: File;
	// Resolved via `connector.getFilePath` at pick-time so the import route
	// doesn't have to await the preload bridge again.
	path: string;
}

export const pendingBackupSlot = createPendingSlot< PendingBackup >();

export const setPendingBackup = pendingBackupSlot.set;
export const peekPendingBackup = pendingBackupSlot.peek;
export const clearPendingBackup = pendingBackupSlot.clear;
