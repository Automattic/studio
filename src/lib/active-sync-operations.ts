/**
 * This set is used to store the IDs of active sync operations. It's used to determine if we should
 * display a confirmation modal before quitting the app.
 */
export const ACTIVE_SYNC_OPERATIONS = new Set();

/**
 * Determine if the set of active push/pull operations has any members.
 */
export function hasActiveSyncOperations(): boolean {
	return ACTIVE_SYNC_OPERATIONS.size > 0;
}
