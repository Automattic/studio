import * as Sentry from '@sentry/electron/renderer';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo } from 'react';
import { SYNC_PUSH_SIZE_LIMIT_GB, SYNC_PUSH_SIZE_LIMIT_BYTES } from '../../constants';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useAuth } from '../use-auth';
import { useImportExport } from '../use-import-export';
import { useSiteDetails } from '../use-site-details';
import { PullStateProgressInfo, useSyncStatesProgressInfo } from '../use-sync-states-progress-info';
import {
	ClearState,
	generateStateId,
	GetState,
	UpdateState,
	usePullPushStates,
} from './use-pull-push-states';
import type { SyncSite } from '../use-fetch-wpcom-sites/types';

export type SyncBackupState = {
	remoteSiteId: number;
	backupId: string | null;
	status: PullStateProgressInfo;
	downloadUrl: string | null;
	selectedSite: SiteDetails;
	isStaging: boolean;
};

export type PullStates = Record< string, SyncBackupState >;
type OnPullSuccess = ( siteId: number, localSiteId: string ) => void;
type PullSite = ( connectedSite: SyncSite, selectedSite: SiteDetails ) => void;
type IsSiteIdPulling = ( selectedSiteId: string, remoteSiteId?: number ) => boolean;

type UseSyncPullProps = {
	pullStates: PullStates;
	setPullStates: React.Dispatch< React.SetStateAction< PullStates > >;
	onPullSuccess?: OnPullSuccess;
};

export type UseSyncPull = {
	pullStates: PullStates;
	getPullState: GetState< SyncBackupState >;
	pullSite: PullSite;
	isAnySitePulling: boolean;
	isSiteIdPulling: IsSiteIdPulling;
	clearPullState: ClearState;
};

export function useSyncPull( {
	pullStates,
	setPullStates,
	onPullSuccess,
}: UseSyncPullProps ): UseSyncPull {
	const { __ } = useI18n();
	const { client } = useAuth();
	const { importFile, clearImportState } = useImportExport();
	const { pullStatesProgressInfo, isKeyPulling, isKeyFinished, isKeyFailed } =
		useSyncStatesProgressInfo();
	const {
		updateState,
		getState: getPullState,
		clearState,
	} = usePullPushStates< SyncBackupState >( pullStates, setPullStates );

	const updatePullState = useCallback< UpdateState< SyncBackupState > >(
		( selectedSiteId, remoteSiteId, state ) => {
			updateState( selectedSiteId, remoteSiteId, state );
			const statusKey = state.status?.key;

			if ( isKeyFailed( statusKey ) || isKeyFinished( statusKey ) ) {
				getIpcApi().clearSyncOperation( generateStateId( selectedSiteId, remoteSiteId ) );
			} else {
				getIpcApi().addSyncOperation( generateStateId( selectedSiteId, remoteSiteId ) );
			}
		},
		[ isKeyFailed, isKeyFinished, updateState ]
	);

	const clearPullState = useCallback< ClearState >(
		( selectedSiteId, remoteSiteId ) => {
			clearState( selectedSiteId, remoteSiteId );
			getIpcApi().clearSyncOperation( generateStateId( selectedSiteId, remoteSiteId ) );
		},
		[ clearState ]
	);

	const { startServer } = useSiteDetails();

	const pullSite = useCallback< PullSite >(
		async ( connectedSite, selectedSite ) => {
			if ( ! client ) {
				return;
			}

			console.groupCollapsed( 'Sync Pull' );

			const remoteSiteId = connectedSite.id;
			updatePullState( selectedSite.id, remoteSiteId, {
				backupId: null,
				status: pullStatesProgressInfo[ 'in-progress' ],
				downloadUrl: null,
				remoteSiteId,
				selectedSite,
				isStaging: connectedSite.isStaging,
			} );

			try {
				console.log( 'Initializing backup on remote' );
				const response = await client.req.post< { success: boolean; backup_id: string } >( {
					path: `/sites/${ remoteSiteId }/studio-app/sync/backup`,
					apiNamespace: 'wpcom/v2',
				} );

				if ( response.success ) {
					updatePullState( selectedSite.id, remoteSiteId, {
						backupId: response.backup_id,
					} );
				} else {
					console.error( response );
					throw new Error( 'Pull request failed' );
				}
			} catch ( error ) {
				console.error( 'Pull request failed:', error );
				console.groupEnd();

				Sentry.captureException( error );
				updatePullState( selectedSite.id, remoteSiteId, {
					status: pullStatesProgressInfo.failed,
				} );

				getIpcApi().showErrorMessageBox( {
					title: sprintf( __( 'Error pulling from %s' ), connectedSite.name ),
					message: __( 'Studio was unable to connect to WordPress.com. Please try again.' ),
				} );
			}
		},
		[ __, client, pullStatesProgressInfo, updatePullState ]
	);

	const checkBackupFileSize = async ( downloadUrl: string ): Promise< number > => {
		try {
			return await getIpcApi().checkSyncBackupSize( downloadUrl );
		} catch ( error ) {
			console.log( 'Failed to check backup file size', error );
			Sentry.captureException( error );
			throw new Error( 'Failed to check backup file size' );
		}
	};

	const onBackupCompleted = useCallback(
		async ( remoteSiteId: number, backupState: SyncBackupState & { downloadUrl: string } ) => {
			const { downloadUrl, selectedSite, isStaging } = backupState;

			try {
				const fileSize = await checkBackupFileSize( downloadUrl );
				console.log( 'Backup file size:', { fileSize, limit: SYNC_PUSH_SIZE_LIMIT_BYTES } );

				if ( fileSize > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
					console.log( 'File size exceeds limit, prompting user' );
					const { response: userChoice } = await getIpcApi().showMessageBox( {
						type: 'warning',
						message: __( "Large site's backup" ),
						detail: sprintf(
							__(
								"Your site's backup exceeds %s GB. Pulling it will prevent you from pushing the site back.\n\nDo you want to continue?"
							),
							SYNC_PUSH_SIZE_LIMIT_GB
						),
						buttons: [ __( 'Continue' ), __( 'Cancel' ) ],
						defaultId: 0,
						cancelId: 1,
					} );

					if ( userChoice === 1 ) {
						console.log( 'User cancelled pull operation' );
						updatePullState( selectedSite.id, remoteSiteId, {
							status: pullStatesProgressInfo.cancelled,
						} );
						clearPullState( selectedSite.id, remoteSiteId );
						return;
					}

					console.log( 'User confirmed to continue despite large file size' );
				}

				console.log( 'Initiating backup file download' );
				updatePullState( selectedSite.id, remoteSiteId, {
					status: pullStatesProgressInfo.downloading,
					downloadUrl,
				} );

				const filePath = await getIpcApi().downloadSyncBackup( remoteSiteId, downloadUrl );
				console.log( 'Download completed', { filePath } );

				console.log( 'Starting import process' );
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
				console.log( 'Import completed successfully' );

				console.log( 'Cleaning up' );
				await getIpcApi().removeSyncBackup( remoteSiteId );

				console.log( 'Starting local server' );
				await startServer( selectedSite.id );

				clearImportState( selectedSite.id );

				console.log( 'Sync pull operation completed successfully' );
				updatePullState( selectedSite.id, remoteSiteId, {
					status: pullStatesProgressInfo.finished,
				} );

				getIpcApi().showNotification( {
					title: selectedSite.name,
					body: isStaging
						? __( 'Studio site updated from Staging' )
						: __( 'Studio site updated from Production' ),
				} );

				onPullSuccess?.( remoteSiteId, selectedSite.id );
			} catch ( error ) {
				console.error( 'Backup completion failed:', error );
				Sentry.captureException( error );
				updatePullState( selectedSite.id, remoteSiteId, {
					status: pullStatesProgressInfo.failed,
				} );
				getIpcApi().showErrorMessageBox( {
					title: sprintf( __( 'Error pulling from %s' ), selectedSite.name ),
					message: __( 'Failed to check backup file size. Please try again.' ),
				} );
			}
			console.groupEnd();
		},
		[
			__,
			clearImportState,
			clearPullState,
			importFile,
			onPullSuccess,
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

			const backupId = getPullState( selectedSiteId, remoteSiteId )?.backupId;
			if ( ! backupId ) {
				console.error( 'No backup ID found' );
				return;
			}

			try {
				const response = await client.req.get< {
					status: 'in-progress' | 'finished' | 'failed';
					download_url: string;
				} >( `/sites/${ remoteSiteId }/studio-app/sync/backup`, {
					apiNamespace: 'wpcom/v2',
					backup_id: backupId,
				} );

				console.log( 'Checking backup status:', response.status );

				const hasBackupCompleted = response.status === 'finished';
				const frontendStatus = hasBackupCompleted
					? pullStatesProgressInfo.downloading.key
					: response.status;
				const statusWithProgress =
					pullStatesProgressInfo[ frontendStatus ] || pullStatesProgressInfo.failed;
				const downloadUrl = hasBackupCompleted ? response.download_url : null;

				if ( hasBackupCompleted && downloadUrl ) {
					// Replacing the 'in-progress' status will stop the active listening for the backup completion
					const backupState = getPullState( selectedSiteId, remoteSiteId );
					if ( backupState ) {
						await onBackupCompleted( remoteSiteId, {
							...backupState,
							downloadUrl,
						} );
						console.groupEnd();
					}
				} else {
					updatePullState( selectedSiteId, remoteSiteId, {
						status: statusWithProgress,
						downloadUrl,
					} );
				}
			} catch ( error ) {
				console.error( 'Failed to fetch backup status:', error );
				console.groupEnd();
				throw error;
			}
		},
		[ client, getPullState, onBackupCompleted, pullStatesProgressInfo, updatePullState ]
	);

	useEffect( () => {
		const intervals: Record< string, NodeJS.Timeout > = {};

		Object.entries( pullStates ).forEach( ( [ key, state ] ) => {
			if ( state.backupId && state.status.key === 'in-progress' ) {
				intervals[ key ] = setTimeout( () => {
					fetchAndUpdateBackup( state.remoteSiteId, state.selectedSite.id );
				}, 2000 );
			}
		} );

		return () => {
			Object.values( intervals ).forEach( clearTimeout );
		};
	}, [ pullStates, fetchAndUpdateBackup ] );

	const isAnySitePulling = useMemo< boolean >( () => {
		return Object.values( pullStates ).some( ( state ) => isKeyPulling( state.status.key ) );
	}, [ pullStates, isKeyPulling ] );

	const isSiteIdPulling = useCallback< IsSiteIdPulling >(
		( selectedSiteId, remoteSiteId ) => {
			return Object.values( pullStates ).some( ( state ) => {
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

	return { pullStates, getPullState, pullSite, isAnySitePulling, isSiteIdPulling, clearPullState };
}
