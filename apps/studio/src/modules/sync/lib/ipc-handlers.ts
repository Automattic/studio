import { app, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
	addConnectedWpcomSite,
	getAllConnectedWpcomSitesForCurrentUser as getAllConnectedWpcomSitesForCurrentUserShared,
	getConnectedWpcomSitesForLocalSite,
	removeConnectedWpcomSite,
	updateConnectedWpcomSites as updateConnectedWpcomSitesShared,
} from '@studio/common/lib/connected-sites';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { getCurrentUserId } from '@studio/common/lib/shared-config';
import { fetchLatestRewindId, fetchSyncableSites } from '@studio/common/lib/sync/sync-api';
import { shouldRetryTusStatus } from '@studio/common/lib/sync/tus-upload';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { pullSite, pushSite } from '@studio/common/sites/sync';
import { PullSyncOptions, PushSyncOptions, SyncSite } from '@studio/common/types/sync';
import { __, sprintf } from '@wordpress/i18n';
import { Upload } from 'tus-js-client';
import { z } from 'zod';
import {
	PullStateProgressInfo,
	PushStateProgressInfo,
} from 'src/hooks/use-sync-states-progress-info';
import { sendIpcEventToRenderer, sendIpcEventToRendererWithWindow } from 'src/ipc-utils';
import { ACTIVE_SYNC_OPERATIONS } from 'src/lib/active-sync-operations';
import { download } from 'src/lib/download';
import { getSyncBackupTempPath } from 'src/lib/get-sync-backup-temp-path';
import { getAuthenticationToken } from 'src/lib/oauth';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { exportSite } from 'src/modules/import-export/lib/ipc-handlers';
import { SiteServer } from 'src/site-server';
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

		let mode: 'full' | 'content' | 'db';
		if ( includes.database && includes.wpContent ) {
			mode = 'full';
		} else if ( includes.wpContent ) {
			mode = 'content';
		} else {
			mode = 'db';
		}

		await exportSite( event, site.details.id, archivePath, {
			mode,
			splitDatabaseDumpByTable: true,
			specificSelectionPaths: configuration?.specificSelectionPaths,
			applyDeployIgnore: true,
			abortSignal: abortController.signal,
		} );

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
				return shouldRetryTusStatus( status );
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

		// A bare upload failure (e.g. a 413) has no `{ error: string }` body, so
		// fall back to the HTTP status for a meaningful message.
		const status = getTusErrorStatus( error );
		if ( status === 413 ) {
			return {
				success: false,
				error: __( 'The site archive is too large to upload right now. Please try again later.' ),
			};
		}
		if ( status ) {
			return {
				success: false,
				// translators: %d is the HTTP status code of the failed upload, e.g. 500.
				error: sprintf( __( 'Upload failed with HTTP status %d.' ), status ),
			};
		}

		return { success: false, error: __( 'Unknown error' ) };
	}
}

function getTusErrorStatus( error: unknown ): number {
	if (
		typeof error === 'object' &&
		error !== null &&
		'originalResponse' in error &&
		error.originalResponse &&
		typeof ( error.originalResponse as { getStatus?: unknown } ).getStatus === 'function'
	) {
		return ( error.originalResponse as { getStatus: () => number } ).getStatus();
	}
	return 0;
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
		// A cancelled operation (user cancel or logout cleanup) aborts this signal. That's an
		// intentional stop, not a failure — return without logging or throwing so it doesn't
		// surface as an error, and let the caller treat the missing path as "stopped".
		if ( abortController.signal.aborted ) {
			return undefined;
		}
		console.error( `[Download] Download failed for operation: ${ operationId }`, error );
		throw error;
	} finally {
		SYNC_ABORT_CONTROLLERS.delete( operationId );
	}
}

export async function removeSyncBackup( event: IpcMainInvokeEvent, remoteSiteId: number ) {
	const filePath = getSyncBackupTempPath( remoteSiteId );
	try {
		await fsPromises.unlink( filePath );
	} catch ( error ) {
		// The backup file may never have been created — e.g. cancelling a pull that was still
		// initializing the remote backup, before anything was downloaded. A missing file is
		// not an error here, so only rethrow unexpected failures.
		if ( ! isErrnoException( error ) || error.code !== 'ENOENT' ) {
			throw error;
		}
	}
}

type WpcomSitesToConnect = { sites: SyncSite[]; localSiteId: string }[];

export async function connectWpcomSites( event: IpcMainInvokeEvent, list: WpcomSitesToConnect ) {
	const currentUserId = await getCurrentUserId();
	if ( ! currentUserId ) {
		throw new Error( 'User not authenticated' );
	}

	for ( const { sites, localSiteId } of list ) {
		for ( const siteToAdd of sites ) {
			await addConnectedWpcomSite( localSiteId, siteToAdd );
		}
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

	for ( const { siteIds, localSiteId } of list ) {
		for ( const id of siteIds ) {
			await removeConnectedWpcomSite( localSiteId, id );
		}
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

	// Group the updates by their local site since our storage is now per-site.
	const byLocalSite = new Map< string, SyncSite[] >();
	for ( const site of updatedSites ) {
		const list = byLocalSite.get( site.localSiteId ) ?? [];
		list.push( site );
		byLocalSite.set( site.localSiteId, list );
	}

	for ( const [ localSiteId, sites ] of byLocalSite ) {
		await updateConnectedWpcomSitesShared( localSiteId, sites );
	}
}

// Wraps the CLI `pull` command for apps/ui. The desktop renderer handles
// pull via `pullSiteThunk` + `pollPullBackupThunk` using its own WPCOM
// client to initiate + poll + download — that polling lives in the
// renderer sync slice with no end-to-end IPC equivalent to reuse. Calling
// the CLI instead keeps apps/ui free of wpcom-client setup and mirrors the
// simpler flow used by `push`. Exchanges everything (`--options all`).
export async function pullSiteFromLive(
	event: IpcMainInvokeEvent,
	siteId: string,
	remoteSiteId: number,
	options?: PullSyncOptions
): Promise< void > {
	const site = SiteServer.get( siteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	const window = BrowserWindow.fromWebContents( event.sender );
	return pullSite(
		executeCliCommand,
		site.details.path,
		remoteSiteId,
		( progress ) => {
			sendIpcEventToRendererWithWindow( window, 'sync-pull-progress', {
				siteId,
				...progress,
			} );
		},
		options
	);
}

// Push for the agentic UI (apps/ui): the same shared `pushSite` the `studio ui`
// server uses, so the agentic UI pushes identically in the desktop and the
// browser (export → TUS upload → import). Progress is forwarded over the
// existing `sync-upload-*` channels. The legacy renderer keeps its own
// `exportSiteForPush` + `pushArchive` (with manual pause/resume) untouched.
export async function pushSiteToLive(
	_event: IpcMainInvokeEvent,
	selectedSiteId: string,
	remoteSiteId: number,
	options?: PushSyncOptions
): Promise< void > {
	const site = SiteServer.get( selectedSiteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) {
		throw new Error( 'No token found' );
	}
	await pushSite(
		{
			executeCliCommand,
			accessToken: token.accessToken,
			emit: ( output ) => {
				if ( output.kind === 'upload-progress' ) {
					void sendIpcEventToRenderer( 'sync-upload-progress', {
						selectedSiteId,
						remoteSiteId,
						progress: output.progress,
					} );
				} else if ( output.kind === 'network-paused' ) {
					void sendIpcEventToRenderer( 'sync-upload-network-paused', {
						selectedSiteId,
						remoteSiteId,
						error: output.error,
					} );
				} else if ( output.kind === 'resumed' ) {
					void sendIpcEventToRenderer( 'sync-upload-resumed', {
						selectedSiteId,
						remoteSiteId,
					} );
				}
			},
		},
		{ sitePath: site.details.path, remoteSiteId, options }
	);
}

// Fetches every WordPress.com site the authenticated user can sync to.
// The desktop renderer builds this list itself via its own WPCOM client
// (see wpcomSitesApi.getWpComSites); apps/ui doesn't own a wpcom client
// yet, so we expose a thin IPC wrapper that reuses the stored auth token.
export async function fetchSyncableWpcomSites( _event: IpcMainInvokeEvent ): Promise< SyncSite[] > {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) {
		throw new Error( 'Authentication required to fetch WordPress.com sites.' );
	}
	return fetchSyncableSites( token.accessToken );
}

export async function getConnectedWpcomSites(
	_event: IpcMainInvokeEvent,
	localSiteId?: string
): Promise< SyncSite[] > {
	if ( localSiteId ) {
		return getConnectedWpcomSitesForLocalSite( localSiteId );
	}
	return getAllConnectedWpcomSitesForCurrentUserShared();
}

/**
 * Latest rewind (backup) id for a remote site — used by the agentic UI's
 * selective pull to browse the remote backup file tree. Returns `null` when
 * the site has no backup yet.
 */
export async function getLatestRewindId(
	_event: IpcMainInvokeEvent,
	remoteSiteId: number
): Promise< string | null > {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) {
		throw new Error( 'No token found' );
	}
	try {
		return await fetchLatestRewindId( token.accessToken, remoteSiteId );
	} catch {
		return null;
	}
}

/**
 * Raw contents of a remote backup directory (rewind backup `ls`), keyed by
 * entry name. The renderer maps entries to tree nodes; returning the raw
 * items preserves `has_children`/`type` used for plugin/theme classification.
 */
export async function listRemoteFileTree(
	_event: IpcMainInvokeEvent,
	remoteSiteId: number,
	rewindId: string,
	treePath: string
): Promise< Record< string, unknown > > {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) {
		throw new Error( 'No token found' );
	}
	const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
	const rawResponse = await wpcom.req.post( {
		path: `/sites/${ remoteSiteId }/rewind/backup/ls`,
		apiNamespace: 'wpcom/v2',
		body: { backup_id: rewindId, path: treePath },
	} );
	const parsed = z
		.object( {
			ok: z.boolean(),
			error: z.string().optional(),
			contents: z.record( z.string(), z.unknown() ).optional(),
		} )
		.parse( rawResponse );
	if ( ! parsed.ok ) {
		throw new Error( parsed.error || 'Failed to fetch remote file tree' );
	}
	return parsed.contents ?? {};
}

/**
 * PHP version of the remote site's hosting environment — used by the agentic
 * UI's sync dialog to warn about version mismatches before pushing.
 */
export async function getHostingPhpVersion(
	_event: IpcMainInvokeEvent,
	remoteSiteId: number
): Promise< string | undefined > {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) {
		throw new Error( 'No token found' );
	}
	try {
		const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
		const response = await wpcom.req.get( {
			apiNamespace: 'wpcom/v2',
			path: `/sites/${ remoteSiteId }/hosting/php-version`,
		} );
		return z.string().parse( response );
	} catch {
		return undefined;
	}
}
