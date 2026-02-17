import { useCallback } from 'react';
import { ClearState, GetState } from 'src/hooks/sync-sites/use-pull-push-states';
import { useAuth } from 'src/hooks/use-auth';
import { ImportResponse, PushStateProgressInfo } from 'src/hooks/use-sync-states-progress-info';
import { store, useAppDispatch, useRootSelector, type RootState } from 'src/stores';
import { syncOperationsSelectors, syncOperationsThunks } from 'src/stores/sync';
import type { SyncSite } from 'src/modules/sync/types';
import type { SyncOption } from 'src/types';

export type SyncPushState = {
	remoteSiteId: number;
	status: PushStateProgressInfo;
	selectedSite: SiteDetails;
	remoteSiteUrl: string;
	uploadProgress?: number;
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
	const getPushState = useCallback< GetState< SyncPushState > >(
		( selectedSiteId, remoteSiteId ) => {
			const state = store.getState();
			return syncOperationsSelectors.selectPushState( selectedSiteId, remoteSiteId )( state );
		},
		[]
	);

	const clearPushState = useCallback< ClearState >(
		( selectedSiteId, remoteSiteId ) => {
			void dispatch( syncOperationsThunks.clearPushState( { selectedSiteId, remoteSiteId } ) );
		},
		[ dispatch ]
	);

	const pushSite = useCallback< PushSite >(
		async ( connectedSite, selectedSite, options ) => {
			if ( ! client ) {
				return;
			}

			try {
				// Polling is triggered automatically by listener middleware
				// when state enters creatingRemoteBackup/applyingChanges/finishing
				await dispatch(
					syncOperationsThunks.pushSite( {
						connectedSite,
						selectedSite,
						options,
					} )
				).unwrap();
			} catch ( error ) {
				// Errors are already handled in the thunk (state updates, error messages)
			}
		},
		[ client, dispatch ]
	);

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
				} )
			);
		},
		[ dispatch ]
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
