import { useCallback } from 'react';
import { ClearState, GetState } from 'src/hooks/sync-sites/use-pull-push-states';
import { useSyncPolling } from 'src/hooks/sync-sites/use-sync-polling';
import { useAuth } from 'src/hooks/use-auth';
import {
	PullStateProgressInfo,
	useSyncStatesProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import { store, useAppDispatch, useRootSelector, type RootState } from 'src/stores';
import {
	syncOperationsActions,
	syncOperationsSelectors,
	syncOperationsThunks,
} from 'src/stores/sync';
import type { SyncSite } from 'src/modules/sync/types';
import type { SyncOption } from 'src/types';

export type SyncBackupState = {
	remoteSiteId: number;
	backupId: string | null;
	status: PullStateProgressInfo;
	downloadUrl: string | null;
	selectedSite: SiteDetails;
	remoteSiteUrl: string;
};

export type PullSiteOptions = {
	optionsToSync: SyncOption[];
	include_path_list?: string[];
};

export type PullStates = Record< string, SyncBackupState >;
type PullSite = (
	connectedSite: SyncSite,
	selectedSite: SiteDetails,
	options: PullSiteOptions
) => void;
type IsSiteIdPulling = ( selectedSiteId: string, remoteSiteId?: number ) => boolean;

type CancelPull = ( selectedSiteId: string, remoteSiteId: number ) => void;

export type UseSyncPull = {
	pullStates: PullStates;
	getPullState: GetState< SyncBackupState >;
	pullSite: PullSite;
	isAnySitePulling: boolean;
	isSiteIdPulling: IsSiteIdPulling;
	clearPullState: ClearState;
	cancelPull: CancelPull;
};

export function useSyncPull(): UseSyncPull {
	const { client } = useAuth();
	const { pullStatesProgressInfo } = useSyncStatesProgressInfo();

	const dispatch = useAppDispatch();
	const pullStates = useRootSelector(
		syncOperationsSelectors.selectPullStates as ( state: RootState ) => PullStates
	);

	const getPullState = useCallback< GetState< SyncBackupState > >(
		( selectedSiteId, remoteSiteId ) => {
			const state = store.getState();
			return syncOperationsSelectors.selectPullState( selectedSiteId, remoteSiteId )( state );
		},
		[]
	);

	const clearPullState = useCallback< ClearState >(
		( selectedSiteId, remoteSiteId ) => {
			// Dispatch both the action and the thunk
			dispatch( syncOperationsActions.clearPullState( { selectedSiteId, remoteSiteId } ) );
			void dispatch( syncOperationsThunks.clearPullState( { selectedSiteId, remoteSiteId } ) );
		},
		[ dispatch ]
	);

	const fetchAndUpdateBackup = useCallback(
		async ( remoteSiteId: number, selectedSiteId: string ) => {
			if ( ! client ) {
				return;
			}
			void dispatch(
				syncOperationsThunks.pollPullBackup( {
					client,
					selectedSiteId,
					remoteSiteId,
					pullStatesProgressInfo,
				} )
			);
		},
		[ client, dispatch, pullStatesProgressInfo ]
	);

	const pullSite = useCallback< PullSite >(
		async ( connectedSite, selectedSite, options ) => {
			if ( ! client ) {
				return;
			}

			try {
				const result = await dispatch(
					syncOperationsThunks.pullSite( {
						client,
						connectedSite,
						selectedSite,
						options,
						pullStatesProgressInfo,
					} )
				).unwrap();

				// Start polling once backupId is set
				if ( result.backupId ) {
					void fetchAndUpdateBackup( result.remoteSiteId, selectedSite.id );
				}
			} catch ( error ) {
				// Errors are already handled in the thunk (state updates, error messages)
			}
		},
		[ client, dispatch, pullStatesProgressInfo, fetchAndUpdateBackup ]
	);

	// Poll for backup status when states have backupId and are in-progress
	const shouldPollPull = useCallback( ( state: SyncBackupState ) => {
		return (
			state.status.key !== 'cancelled' && !! state.backupId && state.status.key === 'in-progress'
		);
	}, [] );

	const pollBackupStatus = useCallback(
		( _key: string, state: SyncBackupState ) => {
			void fetchAndUpdateBackup( state.remoteSiteId, state.selectedSite.id );
		},
		[ fetchAndUpdateBackup ]
	);

	useSyncPolling( pullStates, shouldPollPull, pollBackupStatus, 2000 );

	const isAnySitePulling = useRootSelector( syncOperationsSelectors.selectIsAnySitePulling );

	const isSiteIdPulling = useCallback< IsSiteIdPulling >( ( selectedSiteId, remoteSiteId ) => {
		const state = store.getState();
		return syncOperationsSelectors.selectIsSiteIdPulling( selectedSiteId, remoteSiteId )( state );
	}, [] );

	const cancelPull = useCallback< CancelPull >(
		async ( selectedSiteId, remoteSiteId ) => {
			void dispatch(
				syncOperationsThunks.cancelPull( {
					selectedSiteId,
					remoteSiteId,
					cancelledStatus: pullStatesProgressInfo.cancelled,
				} )
			);
		},
		[ dispatch, pullStatesProgressInfo.cancelled ]
	);

	return {
		pullStates,
		getPullState,
		pullSite,
		isAnySitePulling,
		isSiteIdPulling,
		clearPullState,
		cancelPull,
	};
}
