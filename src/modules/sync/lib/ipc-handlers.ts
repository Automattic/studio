import { app, IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { Upload } from 'tus-js-client';
import { z } from 'zod';
import { isErrnoException } from 'common/lib/is-errno-exception';
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
import wpcomFactory from 'src/lib/wpcom-factory';
import wpcomXhrRequest from 'src/lib/wpcom-xhr-request-factory';
import { SyncSite } from 'src/modules/sync/types';
import { SiteServer } from 'src/site-server';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import { SyncOption } from 'src/types';

const TEMP_DIR = path.join( app.getPath( 'temp' ), 'com.wordpress.studio' );

if ( ! fs.existsSync( TEMP_DIR ) ) {
	fs.mkdirSync( TEMP_DIR );
}

/**
 * Registry to store AbortControllers for ongoing sync operations (push/pull).
 * Key format: `${selectedSiteId}-${remoteSiteId}`
 */
const SYNC_ABORT_CONTROLLERS = new Map< string, AbortController >();

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
	const extension = 'tar.gz';
	const archivePath = path.join( TEMP_DIR, `site_${ id }.${ extension }` );

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

export function removeExportedSiteTmpFile( event: IpcMainInvokeEvent, path: string ) {
	if ( ! path.includes( TEMP_DIR ) ) {
		throw new Error( 'The given path is not a temporary file' );
	}
	try {
		fs.unlinkSync( path );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			// Silently ignore if the temporary file doesn't exist
			Sentry.captureException( error );
		}
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
			onProgress: () => {
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
				// Update the UI only if the upload has started and is paused for any reason.
				if ( hasUploadStarted ) {
					isUploadingPaused = true;
					void sendIpcEventToRenderer( 'sync-upload-paused', {
						selectedSiteId: selectedSiteId,
						remoteSiteId: remoteSiteId,
						error: error.message,
					} );
					console.error( '[TUS] Upload paused: ', error.message );
				}
				return true;
			},
		} );

		upload.start();
	} ).finally( () => {
		file.destroy();
		file.close();
	} );

	const attachmentId = await attachmentPromise;
	const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
	const formData: [ string, unknown, Record< string, string >? ][] = [
		[ 'import_attachment_id', attachmentId ],
	];

	if ( specificSelectionPaths && specificSelectionPaths.length > 0 ) {
		const joinedPaths = specificSelectionPaths.join( ',' );
		formData.push( [ 'list_sync_items', joinedPaths ] );
	}

	if ( optionsToSync ) {
		formData.push( [ 'options', optionsToSync.join( ',' ) ] );
	}

	try {
		await wpcom.req.post( {
			path: `/sites/${ remoteSiteId }/studio-app/sync/import/initiate`,
			apiNamespace: 'wpcom/v2',
			formData,
		} );

		return { success: true };
	} catch ( error ) {
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
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const currentUserId = userData.authToken?.id;

		if ( ! currentUserId ) {
			throw new Error( 'User not authenticated' );
		}

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
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const currentUserId = userData.authToken?.id;

		if ( ! currentUserId ) {
			throw new Error( 'User not authenticated' );
		}

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
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const currentUserId = userData.authToken?.id;

		if ( ! currentUserId ) {
			throw new Error( 'User not authenticated' );
		}

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
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const currentUserId = userData.authToken?.id;

		if ( ! currentUserId ) {
			throw new Error( 'User not authenticated' );
		}

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
	const userData = await loadUserData();

	const currentUserId = userData.authToken?.id;

	if ( ! currentUserId ) {
		return [];
	}

	const allConnected = userData.connectedWpcomSites?.[ currentUserId ] || [];

	if ( localSiteId ) {
		return allConnected.filter( ( site ) => site.localSiteId === localSiteId );
	} else {
		return allConnected;
	}
}
