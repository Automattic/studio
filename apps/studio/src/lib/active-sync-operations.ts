import { canCancelSyncActivity } from '@studio/common/lib/sync/cancel';
import type { SyncActivity, SyncEvent } from '@studio/common/lib/sync/activity';
import type {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';

/**
 * Push/pull operations reported by the legacy renderer.
 */
export const ACTIVE_SYNC_OPERATIONS = new Map<
	string,
	PullStateProgressInfo | PushStateProgressInfo | undefined
>();

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
	const cancellableStateKeys: PushStateProgressInfo[ 'key' ][] = [
		'creatingBackup',
		'uploading',
		'uploadingManuallyPaused',
	];
	if ( ! key ) {
		return false;
	}
	return cancellableStateKeys.includes( key );
}

/**
 * Check if a push operation has finished uploading the backup file.
 */
export function pushBackupIsUploading( key: PushStateProgressInfo[ 'key' ] | undefined ): boolean {
	const uploadingStateKeys: PushStateProgressInfo[ 'key' ][] = [
		'creatingBackup',
		'uploading',
		'uploadingManuallyPaused',
	];
	if ( ! key ) {
		return false;
	}
	return uploadingStateKeys.includes( key );
}
