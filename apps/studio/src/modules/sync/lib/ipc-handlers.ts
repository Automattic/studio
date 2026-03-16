import { app, IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { getCurrentUserId } from '@studio/common/lib/shared-config';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { Upload } from 'tus-js-client';
import { z } from 'zod';
import {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { ACTIVE_SYNC_OPERATIONS } from 'src/lib/active-sync-operations';
import { download } from 'src/lib/download';
import { getSyncBackupTempPath } from 'src/lib/get-sync-backup-temp-path';
import { exportBackup } from 'src/lib/import-export/export/export-manager';
import { ExportOptions } from 'src/lib/import-export/export/types';
import { getAuthenticationToken } from 'src/lib/oauth';
import { keepSqliteIntegrationUpdated } from 'src/lib/sqlite-versions';
import { SyncSite } from 'src/modules/sync/types';
import { SiteServer } from 'src/site-server';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import { SyncOption } from 'src/types';

/**
 * Registry to store AbortControllers for ongoing sync operations (push/pull).
 * Key format: `${selectedSiteId}-${remoteSiteId}`
 */
const SYNC_ABORT_CONTROLLERS = new Map< string, AbortController >();

/**
 * Registry to store TUS upload instances and their pause state for ongoing uploads.
 * Key format: `${selectedSiteId}-${remoteSiteId}`
 * This allows pause/resume functionality for uploads.
 */
type UploadState = {
	upload: Upload;
	isManuallyPaused: boolean;
	abortController: AbortController;
};

const SYNC_TUS_UPLOADS = new Map< string, UploadState >();

/**
 * Pause an ongoing sync upload.
 */
export function pauseSyncUpload(
	event: IpcMainInvokeEvent,
	selectedSiteId: string,
	remoteSiteId: number
) {
	const uploadKey = `${ selectedSiteId }-${ remoteSiteId }`;
	const uploadState = SYNC_TUS_UPLOADS.get( uploadKey );

	if ( uploadState ) {
		if ( uploadState.isManuallyPaused ) {
			return true;
		}

		uploadState.isManuallyPaused = true;
		void uploadState.upload.abort();
		void sendIpcEventToRenderer( 'sync-upload-manually-paused', {
			selectedSiteId,
			remoteSiteId,
		} );
		return true;
	}

	return false;
}

/**
 * Resume a paused sync upload.
 */
export function resumeSyncUpload(
	event: IpcMainInvokeEvent,
	selectedSiteId: string,
	remoteSiteId: number
) {
	const uploadKey = `${ selectedSiteId }-${ remoteSiteId }`;
	const uploadState = SYNC_TUS_UPLOADS.get( uploadKey );

	if ( uploadState ) {
		if ( ! uploadState.isManuallyPaused ) {
			return true;
		}

		uploadState.isManuallyPaused = false;
		uploadState.upload.start();
		void sendIpcEventToRenderer( 'sync-upload-resumed', {
			selectedSiteId,
			remoteSiteId,
		} );
		return true;
	}

	return false;
}

/**
 * Clear the ID of a push/pull operation.
 */
export function clearSyncOperation( event: IpcMainInvokeEvent, id: string ) {
	ACTIVE_SYNC_OPERATIONS.delete( id );
	SYNC_ABORT_CONTROLLERS.delete( id );
}

export function cancelSyncOperation( event: IpcMainInvokeEvent, id: string ) {
	const abortController = SYNC_ABORT_CONTROLLERS.get( id );
	if ( abortController ) {
		abortController.abort();
		SYNC_ABORT_CONTROLLERS.delete( id );
	}

	const uploadState = SYNC_TUS_UPLOADS.get( id );
	if ( uploadState ) {
		uploadState.abortController.abort();
		SYNC_TUS_UPLOADS.delete( id );
	}

	ACTIVE_SYNC_OPERATIONS.delete( id );
}

/**
 * Store the ID of a push/pull operation in a deduped set.
 */
export function addSyncOperation(
	event: IpcMainInvokeEvent,
	id: string,
	state?: PullStateProgressInfo | PushStateProgressInfo
) {
	ACTIVE_SYNC_OPERATIONS.set( id, state );
}

export async function exportSiteForPush(
	event: IpcMainInvokeEvent,
	id: string,
	operationId: string,
	configuration?: {
		optionsToSync?: SyncOption[];
		specificSelectionPaths?: string[];
	}
) {
	const site = SiteServer.get( id );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}

	const tempDir = path.join( app.getPath( 'temp' ), 'com.wordpress.studio', randomUUID() );
	fs.mkdirSync( tempDir, { recursive: true } );
	const archivePath = path.join( tempDir, `site_${ id }.tar.gz` );

	const abortController = new AbortController();
	SYNC_ABORT_CONTROLLERS.set( operationId, abortController );

	try {
		if ( abortController.signal.aborted ) {
			throw new Error( 'Export aborted' );
		}

		await keepSqliteIntegrationUpdated( site.details.path );

		const shouldIncludeSyncOption = (
			optionsToSync: SyncOption[] | undefined,
			option: SyncOption
		): boolean => {
			return (
				optionsToSync?.includes( option ) || optionsToSync?.includes( 'all' ) || ! optionsToSync
			);
		};

		const includes = {
			database: shouldIncludeSyncOption( configuration?.optionsToSync, 'sqls' ),
			wpContent: ( [ 'uploads', 'plugins', 'themes', 'contents' ] as const ).some( ( option ) =>
				shouldIncludeSyncOption( configuration?.optionsToSync, option )
			),
		};

		const exportOptions: ExportOptions = {
			site: site.details,
			backupFile: archivePath,
			includes,
			phpVersion: site.details.phpVersion,
			splitDatabaseDumpByTable: true,
			specificSelectionPaths: configuration?.specificSelectionPaths,
		};

		const onEvent = () => {};
		await exportBackup( exportOptions, onEvent );

		if ( abortController.signal.aborted ) {
			await fsPromises.unlink( archivePath ).catch( () => {
				// Ignore cleanup errors
			} );
			throw new Error( 'Export aborted' );
		}

		const stats = fs.statSync( archivePath );
		return { archivePath, archiveSizeInBytes: stats.size };
	} finally {
		SYNC_ABORT_CONTROLLERS.delete( operationId );
	}
}

export async function pushArchive(
	event: IpcMainInvokeEvent,
	selectedSiteId: string,
	remoteSiteId: number,
	archivePath: string,
	optionsToSync?: string[],
	specificSelectionPaths?: string[]
): Promise< { success: boolean; error?: string } > {
	const token = await getAuthenticationToken();

	if ( ! token?.accessToken ) {
		throw new Error( 'No token found' );
	}

	let hasUploadStarted = false;
	let isUploadingPaused = false;
	const file = fs.createReadStream( archivePath );
	const fileSize = fs.statSync( archivePath ).size;
	const filename = path.basename( archivePath );

	const abortController = new AbortController();
	const uploadKey = `${ selectedSiteId }-${ remoteSiteId }`;

	const attachmentPromise = new Promise< string >( ( resolve, reject ) => {
		const upload = new Upload( file, {
			endpoint: `https://public-api.wordpress.com/rest/v1.1/studio-file-uploads/${ remoteSiteId }`,
			chunkSize: 500000,
			retryDelays: [ 0, 1000, 3000, 5000, 10000, 25000 ],
			overridePatchMethod: true,
			removeFingerprintOnSuccess: true,
			storeFingerprintForResuming: true,
			headers: {
				Authorization: `Bearer ${ token.accessToken }`,
			},
			metadata: {
				filename,
				filetype: 'application/gzip',
			},
			uploadSize: fileSize,
			onBeforeRequest: ( req ) => {
				if ( req.getMethod() === 'HEAD' ) {
					// @ts-expect-error We need to override the method to get the response headers.
					req._method = 'GET';
					req.setHeader( 'X-HTTP-Method-Override', 'HEAD' );
				}
			},
			onError: ( error ) => {
				console.error( '[TUS] Upload error', error );
				reject( error );
			},
			onProgress: ( bytesSent: number, bytesTotal: number ) => {
				if ( isUploadingPaused ) {
					isUploadingPaused = false;
					void sendIpcEventToRenderer( 'sync-upload-resumed', {
						selectedSiteId: selectedSiteId,
						remoteSiteId: remoteSiteId,
					} );
					console.log( '[TUS] Upload resumed' );
				}

				if ( ! hasUploadStarted ) {
					hasUploadStarted = true;
				}

				// Calculate upload progress percentage (0-100)
				const uploadProgress = bytesTotal > 0 ? ( bytesSent / bytesTotal ) * 100 : 0;
				void sendIpcEventToRenderer( 'sync-upload-progress', {
					selectedSiteId: selectedSiteId,
					remoteSiteId: remoteSiteId,
					progress: uploadProgress,
				} );
			},
			onSuccess: ( payload ) => {
				if ( ! payload.lastResponse ) {
					reject( new Error( 'Upload completed but no response received' ) );
					return;
				}

				const attachmentId = payload.lastResponse.getHeader( 'x-studio-file-upload-media-id' );
				if ( attachmentId ) {
					resolve( attachmentId );
				} else {
					reject( new Error( 'Upload completed but required header not found' ) );
				}
			},
			onShouldRetry: ( error ) => {
				// Don't retry or send events if this is a manual pause
				const uploadState = SYNC_TUS_UPLOADS.get( uploadKey );
				if ( uploadState?.isManuallyPaused ) {
					return false;
				}

				// Update the UI only if the upload has started and is paused for network reasons.
				if ( hasUploadStarted ) {
					isUploadingPaused = true;
					void sendIpcEventToRenderer( 'sync-upload-network-paused', {
						selectedSiteId: selectedSiteId,
						remoteSiteId: remoteSiteId,
						error: error.message,
					} );
					console.error( '[TUS] Upload paused due to network error: ', error.message );
				}

				const status = error.originalResponse ? error.originalResponse.getStatus() : 0;
				// Stop retrying if the upload failed because of a 403 error.
				if ( status === 403 ) {
					return false;
				}

				return true;
			},
		} );

		abortController.signal.addEventListener( 'abort', () => {
			void upload.abort();
			reject( new Error( 'Export aborted' ) );
		} );

		const existingUploadState = SYNC_TUS_UPLOADS.get( uploadKey );
		if ( existingUploadState ) {
			// Abort the existing upload if it exists before starting the new one.
			void existingUploadState.upload.abort();
			SYNC_TUS_UPLOADS.delete( uploadKey );
		}

		SYNC_TUS_UPLOADS.set( uploadKey, {
			upload,
			isManuallyPaused: false,
			abortController,
		} );

		upload.start();
	} ).finally( () => {
		SYNC_TUS_UPLOADS.delete( uploadKey );
		file.destroy();
		file.close();
		fs.unlinkSync( archivePath );
	} );

	const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
	const formData: [ string, unknown, Record< string, string >? ][] = [];

	if ( specificSelectionPaths && specificSelectionPaths.length > 0 ) {
		const joinedPaths = specificSelectionPaths.join( ',' );
		formData.push( [ 'list_sync_items', joinedPaths ] );
	}

	if ( optionsToSync ) {
		formData.push( [ 'options', optionsToSync.join( ',' ) ] );
	}

	try {
		const attachmentId = await attachmentPromise;
		formData.push( [ 'import_attachment_id', attachmentId ] );

		await wpcom.req.post( {
			path: `/sites/${ remoteSiteId }/studio-app/sync/import/initiate`,
			apiNamespace: 'wpcom/v2',
			formData,
		} );

		return { success: true };
	} catch ( error ) {
		if ( abortController.signal.aborted ) {
			throw error;
		}

		const parseResult = z.object( { error: z.string() } ).safeParse( error );

		if ( parseResult.success ) {
			return { success: false, error: parseResult.data.error };
		}

		return { success: false, error: 'Unknown error' };
	}
}

export async function downloadSyncBackup(
	event: Electron.IpcMainInvokeEvent,
	remoteSiteId: number,
	downloadUrl: string,
	operationId: string
) {
	const tmpDir = path.join( app.getPath( 'temp' ), 'wp-studio-backups' );
	await fsPromises.mkdir( tmpDir, { recursive: true } );

	const filePath = getSyncBackupTempPath( remoteSiteId );

	const abortController = new AbortController();
	SYNC_ABORT_CONTROLLERS.set( operationId, abortController );

	try {
		await download( downloadUrl, filePath, false, '', abortController.signal );
		return filePath;
	} catch ( error ) {
		if ( error instanceof Error && error.name === 'AbortError' ) {
			// Download was cancelled, throw the error
		} else {
			console.error( `[Download] Download failed for operation: ${ operationId }`, error );
		}
		throw error;
	} finally {
		SYNC_ABORT_CONTROLLERS.delete( operationId );
	}
}

export async function removeSyncBackup( event: IpcMainInvokeEvent, remoteSiteId: number ) {
	const filePath = getSyncBackupTempPath( remoteSiteId );
	await fsPromises.unlink( filePath );
}

type WpcomSitesToConnect = { sites: SyncSite[]; localSiteId: string }[];

export async function connectWpcomSites( event: IpcMainInvokeEvent, list: WpcomSitesToConnect ) {
	const currentUserId = await getCurrentUserId();

	if ( ! currentUserId ) {
		throw new Error( 'User not authenticated' );
	}

	try {
		await lockAppdata();
		const userData = await loadUserData();

		userData.connectedWpcomSites = userData.connectedWpcomSites || {};
		userData.connectedWpcomSites[ currentUserId ] =
			userData.connectedWpcomSites[ currentUserId ] || [];

		const connections = userData.connectedWpcomSites[ currentUserId ];

		list.forEach( ( { sites, localSiteId } ) => {
			sites.forEach( ( siteToAdd ) => {
				const isAlreadyConnected = connections.some(
					( conn ) => conn.id === siteToAdd.id && conn.localSiteId === localSiteId
				);

				// Add the site if it's not already connected
				if ( ! isAlreadyConnected ) {
					connections.push( {
						...siteToAdd,
						localSiteId,
						syncSupport: 'already-connected',
					} );
				}
			} );
		} );

		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

type WpcomSitesToDisconnect = { siteIds: number[]; localSiteId: string }[];

export async function disconnectWpcomSites(
	event: IpcMainInvokeEvent,
	list: WpcomSitesToDisconnect
) {
	const currentUserId = await getCurrentUserId();

	if ( ! currentUserId ) {
		throw new Error( 'User not authenticated' );
	}

	try {
		await lockAppdata();
		const userData = await loadUserData();

		const connectedWpcomSites = userData.connectedWpcomSites;

		// Totally unreal case, added it to help TS parse the code below. And if this error happens, we definitely have something wrong.
		if ( ! Array.isArray( connectedWpcomSites?.[ currentUserId ] ) ) {
			throw new Error(
				'Something went wrong, since you are trying to disconnect something, but there are no stored connections yet'
			);
		}

		list.forEach( ( { siteIds, localSiteId } ) => {
			const updatedConnections = connectedWpcomSites[ currentUserId ].filter(
				( conn ) => ! ( siteIds.includes( conn.id ) && conn.localSiteId === localSiteId )
			);

			connectedWpcomSites[ currentUserId ] = updatedConnections;
		} );

		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function updateConnectedWpcomSites(
	event: IpcMainInvokeEvent,
	updatedSites: SyncSite[]
) {
	const currentUserId = await getCurrentUserId();

	if ( ! currentUserId ) {
		throw new Error( 'User not authenticated' );
	}

	try {
		await lockAppdata();
		const userData = await loadUserData();

		const connections = userData.connectedWpcomSites?.[ currentUserId ] || [];

		if ( ! connections.length ) {
			return;
		}

		updatedSites.forEach( ( updatedSite ) => {
			const index = connections.findIndex(
				( conn ) => conn.id === updatedSite.id && conn.localSiteId === updatedSite.localSiteId
			);

			if ( index !== -1 ) {
				connections[ index ] = updatedSite;
			}
		} );

		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function updateSingleConnectedWpcomSite(
	event: IpcMainInvokeEvent,
	updatedSite: SyncSite
) {
	const currentUserId = await getCurrentUserId();

	if ( ! currentUserId ) {
		throw new Error( 'User not authenticated' );
	}

	try {
		await lockAppdata();
		const userData = await loadUserData();

		const connections = userData.connectedWpcomSites?.[ currentUserId ] || [];
		const index = connections.findIndex(
			( conn ) => conn.id === updatedSite.id && conn.localSiteId === updatedSite.localSiteId
		);

		if ( index !== -1 ) {
			connections[ index ] = updatedSite;
		}

		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function getConnectedWpcomSites(
	event: IpcMainInvokeEvent,
	localSiteId?: string
): Promise< SyncSite[] > {
	const currentUserId = await getCurrentUserId();

	if ( ! currentUserId ) {
		return [];
	}

	const userData = await loadUserData();

	const allConnected = userData.connectedWpcomSites?.[ currentUserId ] || [];

	if ( localSiteId ) {
		return allConnected.filter( ( site ) => site.localSiteId === localSiteId );
	} else {
		return allConnected;
	}
}
