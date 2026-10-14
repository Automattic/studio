import { canCancelSyncActivity } from '@studio/common/lib/sync/cancel';
import type { SyncActivity, SyncEvent } from '@studio/common/lib/sync/activity';

// The push or pull each site is running, as published by the CLI, whoever started it.
const PENDING_SYNCS = new Map< string, SyncActivity >();

export function trackSyncActivity( { siteId, activity }: SyncEvent ): void {
	if ( activity.direction !== 'push' && activity.direction !== 'pull' ) {
		return;
	}
	if ( activity.kind === 'pending' ) {
		PENDING_SYNCS.set( siteId, activity );
	} else {
		PENDING_SYNCS.delete( siteId );
	}
}

export function hasActiveSyncOperations(): boolean {
	return PENDING_SYNCS.size > 0;
}

/**
 * Whether quitting would cancel a sync: the app stops the CLI processes it runs on quit.
 */
export function hasCancellableSyncOperations(): boolean {
	return [ ...PENDING_SYNCS.values() ].some( canCancelSyncActivity );
}
