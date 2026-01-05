import { useCallback } from 'react';
import { ClearState, GetState } from 'src/hooks/sync-sites/use-pull-push-states';
import { useSyncPolling } from 'src/hooks/sync-sites/use-sync-polling';
import { useAuth } from 'src/hooks/use-auth';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import {
	ImportResponse,
	useSyncStatesProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import { store, useAppDispatch, useRootSelector, type RootState } from 'src/stores';
import {
	syncOperationsActions,
	syncOperationsSelectors,
	syncOperationsThunks,
} from 'src/stores/sync';
import type { SyncSite } from 'src/modules/sync/types';
import type { SyncOption } from 'src/types';

export type SyncPushState = {
	remoteSiteId: number;
	status: PushStateProgressInfo;
	selectedSite: SiteDetails;
	remoteSiteUrl: string;
};

type PushSiteOptions = {
	optionsToSync?: SyncOption[];
	specificSelectionPaths?: string[];
};

export type PushStates = Record< string, SyncPushState >;
type PushSite = (
	connectedSite: SyncSite,
	selectedSite: SiteDetails,
	options?: PushSiteOptions
) => Promise< void >;
type IsSiteIdPushing = ( selectedSiteId: string, remoteSiteId?: number ) => boolean;

type CancelPush = ( selectedSiteId: string, remoteSiteId: number ) => void;

export type UseSyncPush = {
	pushStates: PushStates;
	getPushState: GetState< SyncPushState >;
	pushSite: PushSite;
	isAnySitePushing: boolean;
	isSiteIdPushing: IsSiteIdPushing;
	clearPushState: ClearState;
	cancelPush: CancelPush;
};

/**
 * Maps an ImportResponse status to a PushStateProgressInfo object.
 * Returns null if the operation is not in progress or unknown.
 */
export function mapImportResponseToPushState(
	response: ImportResponse,
	pushStatesProgressInfo: Record< PushStateProgressInfo[ 'key' ], PushStateProgressInfo >
): PushStateProgressInfo | null {
	if ( response.status === 'initial_backup_started' ) {
		return pushStatesProgressInfo.creatingRemoteBackup;
	}

	if ( response.status === 'archive_import_started' ) {
		return pushStatesProgressInfo.applyingChanges;
	}

	if ( response.status === 'archive_import_finished' ) {
		return pushStatesProgressInfo.finishing;
	}

	return null;
}

export function useSyncPush(): UseSyncPush {
	const { client } = useAuth();

	const dispatch = useAppDispatch();
	const pushStates = useRootSelector(
		syncOperationsSelectors.selectPushStates as ( state: RootState ) => PushStates
	);
	const { pushStatesProgressInfo } = useSyncStatesProgressInfo();

	const getPushState = useCallback< GetState< SyncPushState > >(
		( selectedSiteId, remoteSiteId ) => {
			const state = store.getState();
			return syncOperationsSelectors.selectPushState( selectedSiteId, remoteSiteId )( state );
		},
		[]
	);

	const clearPushState = useCallback< ClearState >(
		( selectedSiteId, remoteSiteId ) => {
			// Dispatch both the action and the thunk
			dispatch( syncOperationsActions.clearPushState( { selectedSiteId, remoteSiteId } ) );
			void dispatch( syncOperationsThunks.clearPushState( { selectedSiteId, remoteSiteId } ) );
		},
		[ dispatch ]
	);

	const getPushProgressInfo = useCallback(
		async ( remoteSiteId: number, syncPushState: SyncPushState ) => {
			if ( ! client ) {
				return;
			}
			void dispatch(
				syncOperationsThunks.pollPushProgress( {
					client,
					selectedSiteId: syncPushState.selectedSite.id,
					remoteSiteId,
					pushStatesProgressInfo,
				} )
			);
		},
		[ client, dispatch, pushStatesProgressInfo ]
	);

	const pushSite = useCallback< PushSite >(
		async ( connectedSite, selectedSite, options ) => {
			if ( ! client ) {
				return;
			}

			try {
				const result = await dispatch(
					syncOperationsThunks.pushSite( {
						connectedSite,
						selectedSite,
						options,
						pushStatesProgressInfo,
					} )
				).unwrap();

				// If thunk completed successfully and returned polling info, start polling
				if ( result.shouldStartPolling ) {
					const stateForPolling: SyncPushState = {
						remoteSiteId: result.remoteSiteId,
						status: pushStatesProgressInfo.creatingRemoteBackup,
						selectedSite: result.selectedSite,
						remoteSiteUrl: result.remoteSiteUrl,
					};
					void getPushProgressInfo( result.remoteSiteId, stateForPolling );
				}
			} catch ( error ) {
				// Errors are already handled in the thunk (state updates, error messages)
				// Just log if it's an unexpected error
				if ( ! ( error instanceof Error && error.message === 'Export aborted' ) ) {
					// Other errors are already handled in thunk
				}
			}
		},
		[ client, dispatch, pushStatesProgressInfo, getPushProgressInfo ]
	);

	// Poll for push progress when states are in importing status
	// Importing keys: creatingRemoteBackup, applyingChanges, finishing
	const shouldPollPush = useCallback( ( state: SyncPushState ) => {
		const importingKeys = [ 'creatingRemoteBackup', 'applyingChanges', 'finishing' ];
		return (
			state.status && state.status.key !== 'cancelled' && importingKeys.includes( state.status.key )
		);
	}, [] );

	const pollPushProgress = useCallback(
		( _key: string, state: SyncPushState ) => {
			void getPushProgressInfo( state.remoteSiteId, state );
		},
		[ getPushProgressInfo ]
	);

	useSyncPolling( pushStates, shouldPollPush, pollPushProgress, 2000 );

	const isAnySitePushing = useRootSelector( syncOperationsSelectors.selectIsAnySitePushing );

	const isSiteIdPushing = useCallback< IsSiteIdPushing >( ( selectedSiteId, remoteSiteId ) => {
		const state = store.getState();
		return syncOperationsSelectors.selectIsSiteIdPushing( selectedSiteId, remoteSiteId )( state );
	}, [] );

	const cancelPush = useCallback< CancelPush >(
		async ( selectedSiteId, remoteSiteId ) => {
			void dispatch(
				syncOperationsThunks.cancelPush( {
					selectedSiteId,
					remoteSiteId,
					cancelledStatus: pushStatesProgressInfo.cancelled,
				} )
			);
		},
		[ dispatch, pushStatesProgressInfo.cancelled ]
	);

	return {
		pushStates,
		getPushState,
		pushSite,
		isAnySitePushing,
		isSiteIdPushing,
		clearPushState,
		cancelPush,
	};
}
