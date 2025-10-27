import type {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';

export type SyncOperationMetadata = {
	type: 'push' | 'pull';
	status: PullStateProgressInfo | PushStateProgressInfo;
};

/**
 * This map stores active sync operations. The key format is `${localSiteId}-${remoteSiteId}`.
 * This is used to determine if we should display a confirmation modal before quitting the app.
 */
export const ACTIVE_SYNC_OPERATIONS = new Map< string, SyncOperationMetadata | undefined >();

/**
 * Determine if the set of active push/pull operations has any members.
 */
export function hasActiveSyncOperations(): boolean {
	return ACTIVE_SYNC_OPERATIONS.size > 0;
}

/**
 * Check if a pull operation can be cancelled based on its current state.
 */
export function canCancelPull( key: PullStateProgressInfo[ 'key' ] | undefined ): boolean {
	const cancellableStateKeys: PullStateProgressInfo[ 'key' ][] = [ 'in-progress', 'downloading' ];
	if ( ! key ) {
		return false;
	}
	return cancellableStateKeys.includes( key );
}

/**
 * Check if a push operation can be cancelled based on its current state.
 */
export function canCancelPush( key: PushStateProgressInfo[ 'key' ] | undefined ): boolean {
	const cancellableStateKeys: PushStateProgressInfo[ 'key' ][] = [ 'creatingBackup' ];
	if ( ! key ) {
		return false;
	}
	return cancellableStateKeys.includes( key );
}

export function hasCancelableSyncOperations(): boolean {
	//  Iterate over all the sites and check if any operation is cancelable
	for ( const [ , metadata ] of ACTIVE_SYNC_OPERATIONS ) {
		if ( metadata && metadata.status && 'key' in metadata.status ) {
			return canCancelPush( metadata.status.key as PushStateProgressInfo[ 'key' ] );
		}
	}
	// If there is no metadata, is cancelable
	return true;
}
