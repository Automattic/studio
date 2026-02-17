import { useCallback } from 'react';
import { ClearState, GetState } from 'src/hooks/sync-sites/use-pull-push-states';
import { useAuth } from 'src/hooks/use-auth';
import { PullStateProgressInfo } from 'src/hooks/use-sync-states-progress-info';
import { store, useAppDispatch, useRootSelector, type RootState } from 'src/stores';
import { syncOperationsSelectors, syncOperationsThunks } from 'src/stores/sync';
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
			void dispatch( syncOperationsThunks.clearPullState( { selectedSiteId, remoteSiteId } ) );
		},
		[ dispatch ]
	);

	const pullSite = useCallback< PullSite >(
		async ( connectedSite, selectedSite, options ) => {
			if ( ! client ) {
				return;
			}

			try {
				// Polling is triggered automatically by listener middleware
				// when state has backupId and status is in-progress
				await dispatch(
					syncOperationsThunks.pullSite( {
						client,
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
				} )
			);
		},
		[ dispatch ]
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
