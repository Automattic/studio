import { createPendingSlot } from './pending-slot';

/**
 * One-slot handoff for a backup archive picked outside the import route's
 * own UI — currently the drop-target card on the onboarding home screen.
 * The picker stores the file here and navigates to the configure step; the
 * route adopts it into component state on arrival and clears the slot.
 */

export const pendingBackupSlot = createPendingSlot< File >();

export const setPendingBackup = pendingBackupSlot.set;
export const peekPendingBackup = pendingBackupSlot.peek;
export const clearPendingBackup = pendingBackupSlot.clear;
