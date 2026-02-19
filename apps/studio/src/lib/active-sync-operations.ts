import type {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
/**
 * This set is used to store the IDs of active sync operations. It's used to determine if we should
 * display a confirmation modal before quitting the app.
 */
export const ACTIVE_SYNC_OPERATIONS = new Map<
	string,
	PullStateProgressInfo | PushStateProgressInfo | undefined
>();

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

export function hasUploadingPushOperations(): boolean {
	//  Iterate over all the sites and check if any operation is cancelable
	let result = false;
	for ( const [ , state ] of ACTIVE_SYNC_OPERATIONS ) {
		if ( state && 'key' in state ) {
			result = result || pushBackupIsUploading( state.key as PushStateProgressInfo[ 'key' ] );
		}
	}
	return result;
}
