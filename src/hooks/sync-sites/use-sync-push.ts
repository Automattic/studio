import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useRef } from 'react';
import {
	ClearState,
	generateStateId,
	GetState,
	UpdateState,
} from 'src/hooks/sync-sites/use-pull-push-states';
import { useSyncPolling } from 'src/hooks/sync-sites/use-sync-polling';
import { useAuth } from 'src/hooks/use-auth';
import {
	useSyncStatesProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getHostnameFromUrl } from 'src/lib/url-utils';
import { store, useAppDispatch, useRootSelector, type RootState } from 'src/stores';
import {
	syncOperationsActions,
	syncOperationsSelectors,
	syncOperationsThunks,
} from 'src/stores/sync';
import type { ImportResponse } from 'src/hooks/use-sync-states-progress-info';
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
type OnPushSuccess = ( siteId: number, localSiteId: string ) => void;
type PushSite = (
	connectedSite: SyncSite,
	selectedSite: SiteDetails,
	options?: PushSiteOptions
) => Promise< void >;
type IsSiteIdPushing = ( selectedSiteId: string, remoteSiteId?: number ) => boolean;

type UseSyncPushProps = {
	onPushSuccess?: OnPushSuccess;
};

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

export function useSyncPush( { onPushSuccess }: UseSyncPushProps = {} ): UseSyncPush {
	const { __ } = useI18n();
	const { client } = useAuth();

	const dispatch = useAppDispatch();
	const pushStates = useRootSelector(
		syncOperationsSelectors.selectPushStates as ( state: RootState ) => PushStates
	);
	const pushStatesRef = useRef( pushStates );

	// Keep ref in sync with Redux state
	useEffect( () => {
		pushStatesRef.current = pushStates;
	}, [ pushStates ] );

	const updateState = useCallback< UpdateState< SyncPushState > >(
		( selectedSiteId, remoteSiteId, state ) => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			// Immediately update the ref so getPushState returns the latest value
			pushStatesRef.current = {
				...pushStatesRef.current,
				[ stateId ]: {
					...pushStatesRef.current[ stateId ],
					...state,
				} as SyncPushState,
			};
			dispatch(
				syncOperationsActions.updatePushState( {
					selectedSiteId,
					remoteSiteId,
					state,
				} )
			);
		},
		[ dispatch ]
	);

	const getPushState = useCallback< GetState< SyncPushState > >(
		( selectedSiteId, remoteSiteId ) => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			return pushStatesRef.current[ stateId ];
		},
		[]
	);

	const clearState = useCallback< ClearState >(
		( selectedSiteId, remoteSiteId ) => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			// Immediately update the ref so getPushState returns undefined right away
			const newStates = { ...pushStatesRef.current };
			delete newStates[ stateId ];
			pushStatesRef.current = newStates;
			dispatch(
				syncOperationsActions.clearPushState( {
					selectedSiteId,
					remoteSiteId,
				} )
			);
		},
		[ dispatch ]
	);
	const {
		pushStatesProgressInfo,
		isKeyPushing,
		isKeyImporting,
		isKeyFinished,
		isKeyFailed,
		isKeyCancelled,
		getPushStatusWithProgress,
	} = useSyncStatesProgressInfo();

	const updatePushState = useCallback< UpdateState< SyncPushState > >(
		( selectedSiteId, remoteSiteId, state ) => {
			updateState( selectedSiteId, remoteSiteId, state );
			const statusKey = state.status?.key;

			if ( isKeyFailed( statusKey ) || isKeyFinished( statusKey ) || isKeyCancelled( statusKey ) ) {
				getIpcApi().clearSyncOperation( generateStateId( selectedSiteId, remoteSiteId ) );
			} else if ( state.status ) {
				getIpcApi().addSyncOperation(
					generateStateId( selectedSiteId, remoteSiteId ),
					state.status
				);
			}
		},
		[ isKeyFailed, isKeyFinished, isKeyCancelled, updateState ]
	);

	const clearPushState = useCallback< ClearState >(
		( selectedSiteId, remoteSiteId ) => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			// Immediately update the ref so getPushState returns undefined right away
			const newStates = { ...pushStatesRef.current };
			delete newStates[ stateId ];
			pushStatesRef.current = newStates;
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
			const currentState = getPushState( syncPushState.selectedSite.id, remoteSiteId );

			if ( ! currentState || isKeyCancelled( currentState?.status.key ) ) {
				return;
			}

			const response = await client.req.get< ImportResponse >(
				`/sites/${ remoteSiteId }/studio-app/sync/import`,
				{
					apiNamespace: 'wpcom/v2',
				}
			);

			let status: PushStateProgressInfo = pushStatesProgressInfo.creatingRemoteBackup;
			if ( response.success && response.status === 'finished' ) {
				status = pushStatesProgressInfo.finished;
				onPushSuccess?.( remoteSiteId, syncPushState.selectedSite.id );
				getIpcApi().showNotification( {
					title: syncPushState.selectedSite.name,
					body: sprintf(
						// translators: %s is the site url without the protocol.
						__( '%s has been updated' ),
						getHostnameFromUrl( syncPushState.remoteSiteUrl )
					),
				} );
			} else if ( response.success && response.status === 'failed' ) {
				status = pushStatesProgressInfo.failed;
				console.error( 'Push import failed:', {
					remoteSiteId: syncPushState.remoteSiteId,
					error: response.error,
					error_data: response.error_data,
				} );
				// If the impport fails due to a SQL import error, show a more specific message
				const restoreMessage = response.error_data?.vp_restore_message || '';
				const isSqlImportFailure = /importing sql dump/i.test( restoreMessage );
				const isImportTimedOut = response.error === 'Import timed out';
				let message: string;
				if ( isSqlImportFailure ) {
					message = __(
						'Database import failed on the remote site. Please review your database and try again or contact support and provide details from the logs below.'
					);
				} else if ( isImportTimedOut ) {
					message = __(
						"A timeout error occurred while pushing the site, likely due to its large size. Please try reducing the site's content or files and try again. If this problem persists, please contact support."
					);
				} else {
					message = __(
						'An error occurred while pushing the site. If this problem persists, please contact support.'
					);
				}

				getIpcApi().showErrorMessageBox( {
					title: sprintf( __( 'Error pushing to %s' ), syncPushState.selectedSite.name ),
					message,
					showOpenLogs: true,
				} );
			} else if ( response.success && response.status === 'archive_import_started' ) {
				status = pushStatesProgressInfo.applyingChanges;
			} else if ( response.success && response.status === 'archive_import_finished' ) {
				status = pushStatesProgressInfo.finishing;
			}
			status = getPushStatusWithProgress( status, response );
			// Update state in any case to keep polling push state
			updatePushState( syncPushState.selectedSite.id, syncPushState.remoteSiteId, {
				status,
			} );
		},
		[
			__,
			client,
			getPushState,
			getPushStatusWithProgress,
			onPushSuccess,
			pushStatesProgressInfo.applyingChanges,
			pushStatesProgressInfo.creatingRemoteBackup,
			pushStatesProgressInfo.finishing,
			pushStatesProgressInfo.failed,
			pushStatesProgressInfo.finished,
			updatePushState,
			isKeyCancelled,
		]
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

				// Sync ref again after thunk completes to ensure we have the final state
				const finalState = store.getState();
				const finalPushStates = syncOperationsSelectors.selectPushStates( finalState );
				pushStatesRef.current = finalPushStates;

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
				// Sync ref even on error to ensure state is up to date
				const currentState = store.getState();
				const latestPushStates = syncOperationsSelectors.selectPushStates( currentState );
				pushStatesRef.current = latestPushStates;

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
	const shouldPollPush = useCallback(
		( state: SyncPushState ) => {
			return ! isKeyCancelled( state.status.key ) && isKeyImporting( state.status.key );
		},
		[ isKeyCancelled, isKeyImporting ]
	);

	const pollPushProgress = useCallback(
		( _key: string, state: SyncPushState ) => {
			void getPushProgressInfo( state.remoteSiteId, state );
		},
		[ getPushProgressInfo ]
	);

	useSyncPolling( pushStates, shouldPollPush, pollPushProgress, 2000 );

	const isAnySitePushing = useRootSelector( syncOperationsSelectors.selectIsAnySitePushing );

	const isSiteIdPushing = useCallback< IsSiteIdPushing >(
		( selectedSiteId, remoteSiteId ) => {
			return Object.values( pushStates ).some( ( state ) => {
				if ( ! state.selectedSite ) {
					return false;
				}
				if ( state.selectedSite.id !== selectedSiteId ) {
					return false;
				}
				if ( remoteSiteId !== undefined ) {
					return isKeyPushing( state.status.key ) && state.remoteSiteId === remoteSiteId;
				}
				return isKeyPushing( state.status.key );
			} );
		},
		[ pushStates, isKeyPushing ]
	);

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
