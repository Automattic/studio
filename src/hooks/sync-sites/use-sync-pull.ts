import * as Sentry from '@sentry/electron/renderer';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useRef } from 'react';
import { useSyncPolling } from 'src/hooks/sync-sites/use-sync-polling';
import { SYNC_PUSH_SIZE_LIMIT_GB, SYNC_PUSH_SIZE_LIMIT_BYTES } from 'src/constants';
import {
	ClearState,
	generateStateId,
	GetState,
	UpdateState,
} from 'src/hooks/sync-sites/use-pull-push-states';
import { useAuth } from 'src/hooks/use-auth';
import { useImportExport } from 'src/hooks/use-import-export';
import { useSiteDetails } from 'src/hooks/use-site-details';
import {
	PullStateProgressInfo,
	SyncBackupResponse,
	useSyncStatesProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getHostnameFromUrl } from 'src/lib/url-utils';
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
type OnPullSuccess = ( siteId: number, localSiteId: string ) => void;
type PullSite = (
	connectedSite: SyncSite,
	selectedSite: SiteDetails,
	options: PullSiteOptions
) => void;
type IsSiteIdPulling = ( selectedSiteId: string, remoteSiteId?: number ) => boolean;

type UseSyncPullProps = {
	onPullSuccess?: OnPullSuccess;
};

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

export function useSyncPull( { onPullSuccess }: UseSyncPullProps = {} ): UseSyncPull {
	const { __ } = useI18n();
	const { client } = useAuth();
	const { importFile, clearImportState } = useImportExport();
	const {
		pullStatesProgressInfo,
		isKeyPulling,
		isKeyFinished,
		isKeyFailed,
		isKeyCancelled,
		getBackupStatusWithProgress,
	} = useSyncStatesProgressInfo();

	const dispatch = useAppDispatch();
	const pullStates = useRootSelector(
		syncOperationsSelectors.selectPullStates as ( state: RootState ) => PullStates
	);
	const pullStatesRef = useRef( pullStates );

	// Keep ref in sync with Redux state
	useEffect( () => {
		pullStatesRef.current = pullStates;
	}, [ pullStates ] );

	const updateState = useCallback< UpdateState< SyncBackupState > >(
		( selectedSiteId, remoteSiteId, state ) => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			// Immediately update the ref so getPullState returns the latest value
			pullStatesRef.current = {
				...pullStatesRef.current,
				[ stateId ]: {
					...pullStatesRef.current[ stateId ],
					...state,
				} as SyncBackupState,
			};
			dispatch(
				syncOperationsActions.updatePullState( {
					selectedSiteId,
					remoteSiteId,
					state,
				} )
			);
		},
		[ dispatch ]
	);

	const getPullState = useCallback< GetState< SyncBackupState > >(
		( selectedSiteId, remoteSiteId ) => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			return pullStatesRef.current[ stateId ];
		},
		[]
	);

	const updatePullState = useCallback< UpdateState< SyncBackupState > >(
		( selectedSiteId, remoteSiteId, state ) => {
			updateState( selectedSiteId, remoteSiteId, state );
			const statusKey = state.status?.key;

			if ( isKeyFailed( statusKey ) || isKeyFinished( statusKey ) || isKeyCancelled( statusKey ) ) {
				getIpcApi().clearSyncOperation( generateStateId( selectedSiteId, remoteSiteId ) );
			} else {
				getIpcApi().addSyncOperation( generateStateId( selectedSiteId, remoteSiteId ) );
			}
		},
		[ isKeyFailed, isKeyFinished, isKeyCancelled, updateState ]
	);

	const clearPullState = useCallback< ClearState >(
		( selectedSiteId, remoteSiteId ) => {
			const stateId = generateStateId( selectedSiteId, remoteSiteId );
			// Immediately update the ref so getPullState returns undefined right away
			const newStates = { ...pullStatesRef.current };
			delete newStates[ stateId ];
			pullStatesRef.current = newStates;
			// Dispatch both the action and the thunk
			dispatch( syncOperationsActions.clearPullState( { selectedSiteId, remoteSiteId } ) );
			void dispatch( syncOperationsThunks.clearPullState( { selectedSiteId, remoteSiteId } ) );
		},
		[ dispatch ]
	);

	const { startServer } = useSiteDetails();

	const pullSite = useCallback< PullSite >(
		async ( connectedSite, selectedSite, options ) => {
			if ( ! client ) {
				return;
			}

			try {
				await dispatch(
					syncOperationsThunks.pullSite( {
						client,
						connectedSite,
						selectedSite,
						options,
						pullStatesProgressInfo,
					} )
				).unwrap();

				// Sync ref with latest Redux state immediately after thunk completes
				// This ensures getPullState returns the latest value without waiting for re-render
				const currentState = store.getState();
				const latestPullStates = syncOperationsSelectors.selectPullStates( currentState );
				pullStatesRef.current = latestPullStates;
			} catch ( error ) {
				// Sync ref even on error to ensure state is up to date
				const currentState = store.getState();
				const latestPullStates = syncOperationsSelectors.selectPullStates( currentState );
				pullStatesRef.current = latestPullStates;

				// Errors are already handled in the thunk (state updates, error messages)
			}
		},
		[ client, dispatch, pullStatesProgressInfo ]
	);

	const checkBackupFileSize = async ( downloadUrl: string ): Promise< number > => {
		try {
			return await getIpcApi().checkSyncBackupSize( downloadUrl );
		} catch ( error ) {
			console.error( 'Failed to check backup file size', error );
			Sentry.captureException( error );
			throw new Error( 'Failed to check backup file size' );
		}
	};

	const onBackupCompleted = useCallback(
		async ( remoteSiteId: number, backupState: SyncBackupState & { downloadUrl: string } ) => {
			const { downloadUrl, selectedSite, remoteSiteUrl } = backupState;

			try {
				const fileSize = await checkBackupFileSize( downloadUrl );

				if ( fileSize > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
					const CANCEL_ID = 1;

					const { response: userChoice } = await getIpcApi().showMessageBox( {
						type: 'warning',
						message: __( "Large site's backup" ),
						detail: sprintf(
							__(
								"Your site's backup exceeds %d GB. Pulling it will prevent you from pushing the site back.\n\nDo you want to continue?"
							),
							SYNC_PUSH_SIZE_LIMIT_GB
						),
						buttons: [ __( 'Continue' ), __( 'Cancel' ) ],
						defaultId: 0,
						cancelId: CANCEL_ID,
					} );

					if ( userChoice === CANCEL_ID ) {
						updatePullState( selectedSite.id, remoteSiteId, {
							status: pullStatesProgressInfo.cancelled,
						} );
						clearPullState( selectedSite.id, remoteSiteId );
						return;
					}
				}

				// Initiating backup file download
				updatePullState( selectedSite.id, remoteSiteId, {
					status: pullStatesProgressInfo.downloading,
					downloadUrl,
				} );

				const operationId = generateStateId( selectedSite.id, remoteSiteId );
				const filePath = await getIpcApi().downloadSyncBackup(
					remoteSiteId,
					downloadUrl,
					operationId
				);

				const stateAfterDownload = getPullState( selectedSite.id, remoteSiteId );
				if ( ! stateAfterDownload || isKeyCancelled( stateAfterDownload?.status.key ) ) {
					return;
				}

				// Starting import process
				updatePullState( selectedSite.id, remoteSiteId, {
					status: pullStatesProgressInfo.importing,
				} );

				await importFile(
					{
						path: filePath,
						type: 'application/tar+gzip',
					},
					selectedSite,
					{ showImportNotification: false }
				);

				await getIpcApi().removeSyncBackup( remoteSiteId );

				await startServer( selectedSite.id );

				clearImportState( selectedSite.id );

				// Sync pull operation completed successfully
				updatePullState( selectedSite.id, remoteSiteId, {
					status: pullStatesProgressInfo.finished,
				} );

				getIpcApi().showNotification( {
					title: selectedSite.name,
					body: sprintf(
						// translators: %s is the site url without the protocol.
						__( 'Studio site has been updated from %s' ),
						getHostnameFromUrl( remoteSiteUrl )
					),
				} );

				onPullSuccess?.( remoteSiteId, selectedSite.id );
			} catch ( error ) {
				console.error( 'Backup completion failed:', error );

				const currentState = getPullState( selectedSite.id, remoteSiteId );
				if ( currentState && isKeyCancelled( currentState?.status.key ) ) {
					return;
				}

				Sentry.captureException( error );
				updatePullState( selectedSite.id, remoteSiteId, {
					status: pullStatesProgressInfo.failed,
				} );
				getIpcApi().showErrorMessageBox( {
					title: sprintf( __( 'Error pulling from %s' ), selectedSite.name ),
					message: __( 'Failed to check backup file size. Please try again.' ),
				} );
			}
		},
		[
			__,
			clearImportState,
			clearPullState,
			getPullState,
			importFile,
			onPullSuccess,
			isKeyCancelled,
			pullStatesProgressInfo.cancelled,
			pullStatesProgressInfo.downloading,
			pullStatesProgressInfo.failed,
			pullStatesProgressInfo.finished,
			pullStatesProgressInfo.importing,
			startServer,
			updatePullState,
		]
	);

	const fetchAndUpdateBackup = useCallback(
		async ( remoteSiteId: number, selectedSiteId: string ) => {
			if ( ! client ) {
				return;
			}

			const currentState = getPullState( selectedSiteId, remoteSiteId );
			if ( currentState && isKeyCancelled( currentState.status.key ) ) {
				return;
			}

			const backupId = currentState?.backupId;
			if ( ! backupId ) {
				console.error( 'No backup ID found' );
				return;
			}

			try {
				const response = await client.req.get< SyncBackupResponse >(
					`/sites/${ remoteSiteId }/studio-app/sync/backup`,
					{
						apiNamespace: 'wpcom/v2',
						backup_id: backupId,
					}
				);

				const hasBackupCompleted = response.status === 'finished';
				const downloadUrl = hasBackupCompleted ? response.download_url : null;

				if ( downloadUrl ) {
					// Replacing the 'in-progress' status will stop the active listening for the backup completion
					const backupState = getPullState( selectedSiteId, remoteSiteId );
					if ( backupState ) {
						await onBackupCompleted( remoteSiteId, {
							...backupState,
							downloadUrl,
						} );
					}
				} else {
					const statusWithProgress = getBackupStatusWithProgress(
						hasBackupCompleted,
						pullStatesProgressInfo,
						response
					);

					updatePullState( selectedSiteId, remoteSiteId, {
						status: statusWithProgress,
						downloadUrl,
					} );
				}
			} catch ( error ) {
				console.error( 'Failed to fetch backup status:', error );
				throw error;
			}
		},
		[
			client,
			getBackupStatusWithProgress,
			getPullState,
			onBackupCompleted,
			pullStatesProgressInfo,
			updatePullState,
			isKeyCancelled,
		]
	);

	// Poll for backup status when states have backupId and are in-progress
	const shouldPollPull = useCallback(
		( state: SyncBackupState ) => {
			return (
				! isKeyCancelled( state.status.key ) &&
				!! state.backupId &&
				state.status.key === 'in-progress'
			);
		},
		[ isKeyCancelled ]
	);

	const pollBackupStatus = useCallback(
		( _key: string, state: SyncBackupState ) => {
			void fetchAndUpdateBackup( state.remoteSiteId, state.selectedSite.id );
		},
		[ fetchAndUpdateBackup ]
	);

	useSyncPolling( pullStates, shouldPollPull, pollBackupStatus, 2000 );

	const isAnySitePulling = useRootSelector( syncOperationsSelectors.selectIsAnySitePulling );

	const isSiteIdPulling = useCallback< IsSiteIdPulling >(
		( selectedSiteId, remoteSiteId ) => {
			return Object.values( pullStates ).some( ( state ) => {
				if ( ! state.selectedSite ) {
					return false;
				}
				if ( state.selectedSite.id !== selectedSiteId ) {
					return false;
				}
				if ( remoteSiteId !== undefined ) {
					return isKeyPulling( state.status.key ) && state.remoteSiteId === remoteSiteId;
				}
				return isKeyPulling( state.status.key );
			} );
		},
		[ pullStates, isKeyPulling ]
	);

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
