import * as Sentry from '@sentry/electron/renderer';
// @ts-expect-error - Uppy types require newer moduleResolution, but types exist at runtime
import Uppy from '@uppy/core';
// @ts-expect-error - Uppy types require newer moduleResolution, but types exist at runtime
import Tus from '@uppy/tus';
import { sprintf } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useMemo } from 'react';
import {
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	TUS_UPLOAD_CHUNK_SIZE,
	TUS_UPLOAD_ENDPOINT_BASE,
	TUS_UPLOAD_RETRY_DELAYS,
} from 'src/constants';
import {
	ClearState,
	generateStateId,
	GetState,
	UpdateState,
	usePullPushStates,
} from 'src/hooks/sync-sites/use-pull-push-states';
import { useAuth } from 'src/hooks/use-auth';
import {
	useSyncStatesProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { getHostnameFromUrl } from 'src/lib/url-utils';
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
	pushStates: PushStates;
	setPushStates: React.Dispatch< React.SetStateAction< PushStates > >;
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

export function useSyncPush( {
	pushStates,
	setPushStates,
	onPushSuccess,
}: UseSyncPushProps ): UseSyncPush {
	const { __ } = useI18n();
	const { client } = useAuth();
	const {
		updateState,
		getState: getPushState,
		clearState,
	} = usePullPushStates< SyncPushState >( pushStates, setPushStates );
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
			clearState( selectedSiteId, remoteSiteId );
			getIpcApi().clearSyncOperation( generateStateId( selectedSiteId, remoteSiteId ) );
		},
		[ clearState ]
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

	const getErrorFromResponse = useCallback(
		( error: unknown ): string => {
			if (
				typeof error === 'object' &&
				error !== null &&
				'error' in error &&
				typeof ( error as { error: unknown } ).error === 'string'
			) {
				return ( error as { error: string } ).error;
			}

			return __( 'Studio was unable to connect to WordPress.com. Please try again.' );
		},
		[ __ ]
	);

	/**
	 * Converts a file path to a File object for use with TUS
	 * Reads the file via IPC and creates a File object
	 */
	const getFileFromPath = useCallback( async ( filePath: string ): Promise< File > => {
		// Read file content via IPC
		const arrayBuffer = await getIpcApi().readFileAsArrayBuffer( filePath );
		const fileName = filePath.split( /[/\\]/ ).pop() || 'archive.tar.gz';
		const blob = new Blob( [ arrayBuffer ], { type: 'application/gzip' } );
		return new File( [ blob ], fileName, { type: 'application/gzip' } );
	}, [] );

	/**
	 * Uploads a file using Uppy with TUS and Uppy (resumable uploads)
	 */
	const uploadArchive = useCallback(
		async (
			archivePath: string,
			remoteSiteId: number,
			onUploadProgress?: ( percentage: number ) => void
		): Promise< number > => {
			// Get authentication token
			const token = await getIpcApi().getAuthenticationToken();
			if ( ! token?.accessToken ) {
				throw new Error( 'No authentication token found' );
			}

			// Read file content via IPC and create File object
			const file = await getFileFromPath( archivePath );

			return new Promise< number >( ( resolve, reject ) => {
				// Create Uppy instance
				const uppy = new Uppy( {
					debug: true,
					autoProceed: true,
					allowMultiple: false,
					restrictions: {
						maxNumberOfFiles: 1,
						maxFileSize: SYNC_PUSH_SIZE_LIMIT_BYTES,
					},
				} );

				// Configure TUS plugin
				uppy.use( Tus, {
					endpoint: `${ TUS_UPLOAD_ENDPOINT_BASE }/${ remoteSiteId }`,
					chunkSize: TUS_UPLOAD_CHUNK_SIZE,
					retryDelays: TUS_UPLOAD_RETRY_DELAYS,
					removeFingerprintOnSuccess: true,
					headers: {
						Authorization: `Bearer ${ token.accessToken }`,
					},
					onBeforeRequest: ( req: Tus.HttpRequest ) => {
						// make ALL requests be either POST or GET to honor the public-api.wordpress.com "contract".
						const method = req._method;
						if ( [ 'HEAD', 'OPTIONS' ].indexOf( method ) >= 0 ) {
							req._method = 'GET';
							req.setHeader( 'X-HTTP-Method-Override', method );
						}

						if ( [ 'DELETE', 'PUT', 'PATCH' ].indexOf( method ) >= 0 ) {
							req._method = 'POST';
							req.setHeader( 'X-HTTP-Method-Override', method );
						}

						req._xhr.open( req._method, req._url, true );

						Object.keys( req._headers ).map( ( headerName ) => {
							req.setHeader( headerName, req._headers[ headerName ] );
						} );

						return req;
					},
				} );

				uppy.on( 'upload-error', ( file: Uppy.UppyFile, error: Error ) => {
					reject( error );
				} );

				uppy.on( 'upload-progress', ( file: Uppy.UppyFile, progress: Uppy.ProgressEvent ) => {
					const percentage = ( progress.bytesUploaded / progress.bytesTotal ) * 100;
					if ( onUploadProgress ) {
						onUploadProgress( percentage );
					}
				} );

				uppy.on( 'upload-success', ( file: Uppy.UppyFile, response: Uppy.UploadResponse ) => {
					const xhr = response.body.xhr as XMLHttpRequest;
					const attachmentId = xhr.getResponseHeader( 'x-videopress-upload-media-id' );
					if ( attachmentId ) {
						resolve( parseInt( attachmentId ) );
					} else {
						reject( new Error( 'The upload failed.' ) );
					}
				} );

				uppy.on( 'complete', ( result: Uppy.UppyFile ) => {
					console.log( 'Upload complete:', result );
				} );

				// Add file to Uppy and start upload
				uppy.addFile( {
					source: 'Local',
					name: file.name,
					type: file.type,
					data: file,
				} );
			} );
		},
		[ getFileFromPath ]
	);

	const pushSite = useCallback< PushSite >(
		async ( connectedSite, selectedSite, options ) => {
			if ( ! client ) {
				return;
			}
			const remoteSiteId = connectedSite.id;
			const remoteSiteUrl = connectedSite.url;
			const operationId = generateStateId( selectedSite.id, remoteSiteId );

			clearPushState( selectedSite.id, remoteSiteId );
			updatePushState( selectedSite.id, remoteSiteId, {
				remoteSiteId,
				status: pushStatesProgressInfo.creatingBackup,
				selectedSite,
				remoteSiteUrl,
			} );

			let archivePath: string, archiveSizeInBytes: number;

			try {
				const result = await getIpcApi().exportSiteForPush( selectedSite.id, operationId, {
					optionsToSync: options?.optionsToSync,
					specificSelectionPaths: options?.specificSelectionPaths,
				} );
				( { archivePath, archiveSizeInBytes } = result );
			} catch ( error ) {
				if ( error instanceof Error && error.message === 'Export aborted' ) {
					updatePushState( selectedSite.id, remoteSiteId, {
						status: pushStatesProgressInfo.cancelled,
					} );
					return;
				}

				Sentry.captureException( error );
				updatePushState( selectedSite.id, remoteSiteId, {
					status: pushStatesProgressInfo.failed,
				} );
				getIpcApi().showErrorMessageBox( {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: __(
						'An error occurred while pushing the site. If this problem persists, please contact support.'
					),
					error,
					showOpenLogs: true,
				} );
				return;
			}

			if ( archiveSizeInBytes > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
				updatePushState( selectedSite.id, remoteSiteId, {
					status: pushStatesProgressInfo.failed,
				} );
				getIpcApi().showErrorMessageBox( {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: __(
						'The site is too large to push. Please reduce the size of the site and try again.'
					),
				} );
				await getIpcApi().removeExportedSiteTmpFile( archivePath );
				return;
			}

			const stateBeforeUpload = getPushState( selectedSite.id, remoteSiteId );

			if ( ! stateBeforeUpload || isKeyCancelled( stateBeforeUpload?.status.key ) ) {
				return;
			}

			updatePushState( selectedSite.id, remoteSiteId, {
				status: pushStatesProgressInfo.uploading,
			} );

			try {
				// Upload file using TUS (resumable uploads)
				const attachmentId = await uploadArchive( archivePath, remoteSiteId, ( percentage ) => {
					console.log( 'Upload progress:', percentage );
				} );

				const stateAfterUpload = getPushState( selectedSite.id, remoteSiteId );

				if ( isKeyCancelled( stateAfterUpload?.status.key ) ) {
					return;
				}

				const formData: [ string, unknown, Record< string, string >? ][] = [
					[ 'import_attachment_id', attachmentId ],
				];

				if ( options?.specificSelectionPaths && options?.specificSelectionPaths.length > 0 ) {
					const joinedPaths = options?.specificSelectionPaths.join( ',' );
					formData.push( [ 'list_sync_items', joinedPaths ] );
				}

				if ( options?.optionsToSync ) {
					formData.push( [ 'options', options?.optionsToSync.join( ',' ) ] );
				}

				// Uses the import/initiate endpoint to initiate the import.
				const response = await client.req.post< {
					success: boolean;
				} >( {
					path: `/sites/${ remoteSiteId }/studio-app/sync/import/initiate`,
					apiNamespace: 'wpcom/v2',
					formData,
				} );

				const stateAfterImport = getPushState( selectedSite.id, remoteSiteId );

				if ( isKeyCancelled( stateAfterImport?.status.key ) ) {
					return;
				}

				if ( response.success ) {
					updatePushState( selectedSite.id, remoteSiteId, {
						status: pushStatesProgressInfo.creatingRemoteBackup,
					} );
				} else {
					throw response;
				}
			} catch ( error ) {
				Sentry.captureException( error );
				updatePushState( selectedSite.id, remoteSiteId, {
					status: pushStatesProgressInfo.failed,
				} );
				getIpcApi().showErrorMessageBox( {
					title: sprintf( __( 'Error pushing to %s' ), connectedSite.name ),
					message: getErrorFromResponse( error ),
				} );
			} finally {
				await getIpcApi().removeExportedSiteTmpFile( archivePath );
			}
		},
		[
			__,
			clearPushState,
			client,
			getPushState,
			pushStatesProgressInfo,
			updatePushState,
			getErrorFromResponse,
			isKeyCancelled,
			uploadArchive,
		]
	);

	useEffect( () => {
		const intervals: Record< string, NodeJS.Timeout > = {};

		Object.entries( pushStates ).forEach( ( [ key, state ] ) => {
			if ( isKeyCancelled( state.status.key ) ) {
				return;
			}

			if ( isKeyImporting( state.status.key ) ) {
				intervals[ key ] = setTimeout( () => {
					void getPushProgressInfo( state.remoteSiteId, state );
				}, 2000 );
			}
		} );

		return () => {
			Object.values( intervals ).forEach( clearTimeout );
		};
	}, [
		pushStates,
		getPushProgressInfo,
		pushStatesProgressInfo.creatingBackup.key,
		pushStatesProgressInfo.applyingChanges.key,
		isKeyImporting,
		isKeyCancelled,
	] );

	const isAnySitePushing = useMemo< boolean >( () => {
		return Object.values( pushStates ).some( ( state ) => isKeyPushing( state.status.key ) );
	}, [ pushStates, isKeyPushing ] );

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
			const operationId = generateStateId( selectedSiteId, remoteSiteId );
			getIpcApi().cancelSyncOperation( operationId );

			updatePushState( selectedSiteId, remoteSiteId, {
				status: pushStatesProgressInfo.cancelled,
			} );

			getIpcApi().showNotification( {
				title: __( 'Push cancelled' ),
				body: __( 'The push operation has been cancelled.' ),
			} );
		},
		[ __, pushStatesProgressInfo.cancelled, updatePushState ]
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
