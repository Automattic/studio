import { app, IpcMainInvokeEvent } from 'electron';
import fsPromises from 'fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { isWordPressDirectory } from '@studio/common/lib/fs-utils';
import { __ } from '@wordpress/i18n';
import * as tar from 'tar';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { defaultImporterOptions, importBackup } from 'src/lib/import-export/import/import-manager';
import {
	cpanelDeleteFile,
	cpanelDownloadFile,
	cpanelDumpDatabase,
	cpanelUapi,
} from 'src/modules/cpanel/lib/cpanel-api';
import { SiteServer } from 'src/site-server';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { CpanelPullStatusInfo, CpanelSyncSite } from 'src/modules/cpanel/types';

/**
 * Registry to track AbortControllers for ongoing cPanel pull operations.
 * Key format: `${localSiteId}-${cpanelSiteId}`
 */
const CPANEL_ABORT_CONTROLLERS = new Map< string, AbortController >();

function operationKey( localSiteId: string, cpanelSiteId: string ): string {
	return `${ localSiteId }-${ cpanelSiteId }`;
}

async function emitPullProgress(
	localSiteId: string,
	cpanelSiteId: string,
	status: CpanelPullStatusInfo
): Promise< void > {
	await sendIpcEventToRenderer( 'cpanel-pull-progress', {
		localSiteId,
		cpanelSiteId,
		status,
	} );
}

// ---------------------------------------------------------------------------
// Connection management
// ---------------------------------------------------------------------------

export async function connectCpanelSite(
	event: IpcMainInvokeEvent,
	site: Omit< CpanelSyncSite, 'id' | 'lastPullTimestamp' >
): Promise< CpanelSyncSite > {
	// Validate credentials by listing files at wpPath.
	await cpanelUapi( site, 'Fileman', 'list_files', { dir: site.wpPath } );

	const newSite: CpanelSyncSite = {
		...site,
		id: randomUUID(),
		lastPullTimestamp: null,
	};

	try {
		await lockAppdata();
		const userData = await loadUserData();
		userData.connectedCpanelSites = userData.connectedCpanelSites ?? [];

		const alreadyConnected = userData.connectedCpanelSites.some(
			( s ) => s.hostname === site.hostname && s.localSiteId === site.localSiteId
		);

		if ( ! alreadyConnected ) {
			userData.connectedCpanelSites.push( newSite );
			await saveUserData( userData );
		}
	} finally {
		await unlockAppdata();
	}

	return newSite;
}

export async function disconnectCpanelSite(
	event: IpcMainInvokeEvent,
	cpanelSiteId: string,
	localSiteId: string
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		userData.connectedCpanelSites = ( userData.connectedCpanelSites ?? [] ).filter(
			( s ) => ! ( s.id === cpanelSiteId && s.localSiteId === localSiteId )
		);
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

export async function getConnectedCpanelSites(
	event: IpcMainInvokeEvent,
	localSiteId?: string
): Promise< CpanelSyncSite[] > {
	const userData = await loadUserData();
	const all = userData.connectedCpanelSites ?? [];
	return localSiteId ? all.filter( ( s ) => s.localSiteId === localSiteId ) : all;
}

export async function updateConnectedCpanelSites(
	event: IpcMainInvokeEvent,
	updatedSites: CpanelSyncSite[]
): Promise< void > {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		const all = userData.connectedCpanelSites ?? [];

		updatedSites.forEach( ( updated ) => {
			const idx = all.findIndex(
				( s ) => s.id === updated.id && s.localSiteId === updated.localSiteId
			);
			if ( idx !== -1 ) {
				all[ idx ] = updated;
			}
		} );

		userData.connectedCpanelSites = all;
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

// ---------------------------------------------------------------------------
// Pull: cPanel → local Studio
// ---------------------------------------------------------------------------

export async function pullCpanelSite(
	event: IpcMainInvokeEvent,
	cpanelSiteId: string,
	localSiteId: string
): Promise< void > {
	const userData = await loadUserData();
	const cpanelSite = ( userData.connectedCpanelSites ?? [] ).find(
		( s ) => s.id === cpanelSiteId && s.localSiteId === localSiteId
	);

	if ( ! cpanelSite ) {
		throw new Error( 'cPanel connection not found.' );
	}

	const siteServer = SiteServer.get( localSiteId );
	if ( ! siteServer ) {
		throw new Error( 'Local site not found.' );
	}

	const abortController = new AbortController();
	const key = operationKey( localSiteId, cpanelSiteId );
	CPANEL_ABORT_CONTROLLERS.set( key, abortController );

	const tmpDir = path.join(
		app.getPath( 'temp' ),
		'com.wordpress.studio',
		`cpanel-${ randomUUID() }`
	);

	const remoteArchiveName = `studio-cpanel-${ Date.now() }.tar.gz`;
	// Place the archive in the WordPress parent directory on the remote server
	const remoteArchiveDir = path.dirname( cpanelSite.wpPath ).replace( /\\/g, '/' ) || '.';
	const localWpContentArchive = path.join( tmpDir, 'wp-content.tar.gz' );
	const localSqlFile = path.join( tmpDir, 'site.sql' );
	const finalArchivePath = path.join( tmpDir, 'cpanel-backup.tar.gz' );

	try {
		await fsPromises.mkdir( tmpDir, { recursive: true } );

		// Step 1: Compress wp-content directory on the remote server
		await emitPullProgress( localSiteId, cpanelSiteId, {
			key: 'compressing',
			progress: 10,
			message: __( 'Compressing files on server…' ),
		} );

		if ( abortController.signal.aborted ) {
			throw new Error( 'Cancelled' );
		}

		const wpContentPath = `${ cpanelSite.wpPath }/wp-content`;
		await cpanelUapi(
			cpanelSite,
			'Fileman',
			'compress',
			{
				'files-0': wpContentPath,
				type: 'tar.gz',
				'dest-dir': remoteArchiveDir,
				'dest-file': remoteArchiveName,
			},
			'POST'
		);

		// Step 2: Download the archive
		await emitPullProgress( localSiteId, cpanelSiteId, {
			key: 'downloading',
			progress: 30,
			message: __( 'Downloading files…' ),
		} );

		if ( abortController.signal.aborted ) {
			throw new Error( 'Cancelled' );
		}

		await cpanelDownloadFile(
			cpanelSite,
			remoteArchiveDir,
			remoteArchiveName,
			localWpContentArchive,
			abortController.signal
		);

		// Step 3: Export database
		await emitPullProgress( localSiteId, cpanelSiteId, {
			key: 'exporting-db',
			progress: 55,
			message: __( 'Exporting database…' ),
		} );

		if ( abortController.signal.aborted ) {
			throw new Error( 'Cancelled' );
		}

		const sqlDump = await cpanelDumpDatabase( cpanelSite, cpanelSite.dbName );
		await fsPromises.writeFile( localSqlFile, sqlDump, 'utf8' );

		// Step 4: Build a Jetpack-format archive for importBackup
		await emitPullProgress( localSiteId, cpanelSiteId, {
			key: 'building-archive',
			progress: 65,
			message: __( 'Building archive…' ),
		} );

		await buildJetpackArchive( {
			wpContentArchivePath: localWpContentArchive,
			sqlFilePath: localSqlFile,
			outputPath: finalArchivePath,
		} );

		// Step 5: Import into local site
		await emitPullProgress( localSiteId, cpanelSiteId, {
			key: 'importing',
			progress: 75,
			message: __( 'Importing into local site…' ),
		} );

		if ( abortController.signal.aborted ) {
			throw new Error( 'Cancelled' );
		}

		const wasRunning = siteServer.details.running;
		if ( wasRunning ) {
			await siteServer.stop();
		}

		try {
			if ( ! isWordPressDirectory( siteServer.details.path ) ) {
				await setupWordPressFilesOnly( siteServer.details.path );
			}

			await importBackup(
				{ path: finalArchivePath, type: 'application/tar+gzip' },
				siteServer.details,
				() => {},
				defaultImporterOptions
			);
		} finally {
			if ( wasRunning ) {
				await siteServer.start();
			}
		}

		// Step 6: Record timestamp
		await updateConnectedCpanelSites( event, [
			{ ...cpanelSite, lastPullTimestamp: new Date().toISOString() },
		] );

		await emitPullProgress( localSiteId, cpanelSiteId, {
			key: 'finished',
			progress: 100,
			message: __( 'Pull complete' ),
		} );

		// Clean up remote temp archive (best-effort)
		cpanelDeleteFile( cpanelSite, remoteArchiveDir, remoteArchiveName ).catch( () => {} );
	} catch ( error ) {
		const isCancelled = error instanceof Error && error.message === 'Cancelled';
		await emitPullProgress( localSiteId, cpanelSiteId, {
			key: isCancelled ? 'cancelled' : 'failed',
			progress: 100,
			message: isCancelled ? __( 'Pull cancelled' ) : __( 'Error pulling site' ),
		} );
		if ( ! isCancelled ) {
			throw error;
		}
	} finally {
		CPANEL_ABORT_CONTROLLERS.delete( key );
		// Clean up local temp files (best-effort)
		fsPromises.rm( tmpDir, { recursive: true, force: true } ).catch( () => {} );
	}
}

export function cancelCpanelPull(
	event: IpcMainInvokeEvent,
	localSiteId: string,
	cpanelSiteId: string
): void {
	const key = operationKey( localSiteId, cpanelSiteId );
	const controller = CPANEL_ABORT_CONTROLLERS.get( key );
	if ( controller ) {
		controller.abort();
		CPANEL_ABORT_CONTROLLERS.delete( key );
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Jetpack-format tar.gz that importBackup can handle:
 *   sql/site.sql  — the database dump
 *   wp-content/… — all files from the downloaded wp-content archive
 *
 * Strategy:
 * 1. Extract the downloaded wp-content archive into a staging directory.
 * 2. Locate the wp-content directory within it (cPanel may include leading path segments).
 * 3. Write the SQL dump as staging/sql/site.sql.
 * 4. Use tar.create() to pack the staging directory.
 */
async function buildJetpackArchive( {
	wpContentArchivePath,
	sqlFilePath,
	outputPath,
}: {
	wpContentArchivePath: string;
	sqlFilePath: string;
	outputPath: string;
} ): Promise< void > {
	const stagingDir = `${ outputPath }-staging`;
	await fsPromises.mkdir( stagingDir, { recursive: true } );

	// Extract the downloaded wp-content archive
	await tar.extract( {
		file: wpContentArchivePath,
		cwd: stagingDir,
		// Strip path components before wp-content by using a filter
		filter: ( entryPath ) => {
			// Accept any path that contains wp-content/
			return entryPath.includes( 'wp-content' );
		},
		strip: computeStripDepth( wpContentArchivePath ),
	} );

	// Write the SQL dump
	const sqlDir = path.join( stagingDir, 'sql' );
	await fsPromises.mkdir( sqlDir, { recursive: true } );
	await fsPromises.copyFile( sqlFilePath, path.join( sqlDir, 'site.sql' ) );

	// Pack into the Jetpack-format tar.gz
	await tar.create(
		{
			gzip: true,
			file: outputPath,
			cwd: stagingDir,
		},
		await fsPromises.readdir( stagingDir )
	);

	// Clean up staging dir
	await fsPromises.rm( stagingDir, { recursive: true, force: true } );
}

/**
 * Inspect the first entry of a tar.gz archive to determine how many path
 * components appear before the `wp-content` directory, so tar.extract's
 * `strip` option can remove them.
 */
function computeStripDepth( archivePath: string ): number {
	// Use synchronous list to keep this simple (archive is local and small-ish)
	let stripDepth = 0;
	try {
		// tar.list is async; use an approach compatible with sync context
		// We'll set the depth when we first encounter a wp-content path entry.
		const entryPaths: string[] = [];
		// This is synchronous because we pass `sync: true`
		tar.list( {
			file: archivePath,
			sync: true,
			onReadEntry: ( entry ) => {
				entryPaths.push( entry.path );
			},
		} );

		const sample = entryPaths.find( ( p ) => p.includes( 'wp-content/' ) );
		if ( sample ) {
			const parts = sample.replace( /\\/g, '/' ).split( '/' );
			const idx = parts.indexOf( 'wp-content' );
			if ( idx > 0 ) {
				stripDepth = idx;
			}
		}
	} catch {
		// Fall back to no stripping
	}
	return stripDepth;
}

/**
 * Set up a bare WordPress directory structure for the import to populate.
 * Mirrors the pattern in the main importSite IPC handler.
 */
async function setupWordPressFilesOnly( sitePath: string ): Promise< void > {
	// A minimal wp-content directory is enough for the importer to proceed.
	await fsPromises.mkdir( path.join( sitePath, 'wp-content' ), { recursive: true } );
}
