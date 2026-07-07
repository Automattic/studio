import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { CheckpointEvents } from '@studio/common/lib/checkpoint-events';
import { __, sprintf } from '@wordpress/i18n';
import { clearSiteLatestCliPid, updateSitePhpVersion } from 'cli/lib/cli-config/sites';
import { updateSiteUrl } from 'cli/lib/import-export/import/update-site-url';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { SITE_DATABASE_RELATIVE_PATH } from './capture-database';
import { createCheckpoint } from './create';
import { CheckpointEventEmitter } from './events';
import {
	readCheckpointManifest,
	removeRestoreJournal,
	updateCheckpointIndex,
	writeRestoreJournal,
	CHECKPOINT_STORE_VERSION,
	type CheckpointManifest,
} from './manifest';
import { objectExists, readObjectToFile } from './store';
import { walkSite } from './walker';
import type { SiteData } from 'cli/lib/cli-config/core';
import type { Logger } from 'cli/logger';

export interface RestoreCheckpointOptions {
	emitter?: CheckpointEventEmitter;
	// Skip the automatic safety checkpoint. Only for crash-recovery re-apply,
	// where the pre-restore checkpoint from the interrupted attempt already
	// exists.
	skipSafetyCheckpoint?: boolean;
}

export interface RestoreCheckpointResult {
	checkpointId: string;
	safetyCheckpointId?: string;
}

async function setCheckpointPinned(
	siteId: string,
	checkpointId: string,
	pinned: boolean
): Promise< void > {
	await updateCheckpointIndex( siteId, ( index ) => {
		const entry = index.checkpoints.find( ( candidate ) => candidate.id === checkpointId );
		if ( ! entry ) {
			throw new Error( sprintf( __( 'Checkpoint not found: %s' ), checkpointId ) );
		}
		if ( pinned ) {
			entry.pinned = true;
		} else {
			delete entry.pinned;
		}
		return index;
	} );
}

async function verifyManifestObjects(
	siteId: string,
	manifest: CheckpointManifest
): Promise< void > {
	if ( ! ( await objectExists( siteId, manifest.db.hash ) ) ) {
		throw new Error( __( 'The checkpoint is incomplete: its database object is missing.' ) );
	}
	for ( const [ relPath, entry ] of Object.entries( manifest.files ) ) {
		if ( 'hash' in entry && ! ( await objectExists( siteId, entry.hash ) ) ) {
			throw new Error(
				sprintf( __( 'The checkpoint is incomplete: object for %s is missing.' ), relPath )
			);
		}
	}
}

async function applyFiles(
	site: SiteData,
	manifest: CheckpointManifest,
	emitter: CheckpointEventEmitter
): Promise< void > {
	// Deletions are computed from a FRESH walk taken after the server stopped —
	// not from the safety checkpoint's earlier walk — so files created in
	// between are still removed. The walk only sees captured scope, so
	// excluded paths (.git, node_modules, the SQLite integration, logs) are
	// never touched.
	const currentWalk = await walkSite( site.path );
	const targetPaths = new Set( Object.keys( manifest.files ) );

	for ( const file of currentWalk.files ) {
		if ( ! targetPaths.has( file.relPath ) ) {
			await fsPromises.rm( file.fullPath, { force: true } );
		}
	}
	for ( const symlink of currentWalk.symlinks ) {
		if ( ! targetPaths.has( symlink.relPath ) ) {
			await fsPromises.rm( path.join( site.path, symlink.relPath ), { force: true } );
		}
	}

	// Prune directories that hold no target entries — including empty shells
	// left by the deletions above (e.g. a plugin folder whose only file was
	// removed). Deepest-first; rmdir refuses non-empty dirs, so anything that
	// still has content (excluded paths and all) survives untouched.
	const targetDirectories = new Set< string >();
	for ( const relPath of targetPaths ) {
		let parent = relPath;
		while ( parent.includes( '/' ) ) {
			parent = parent.slice( 0, parent.lastIndexOf( '/' ) );
			targetDirectories.add( parent );
		}
	}
	const removableDirectories = currentWalk.directories
		.filter( ( dir ) => ! targetDirectories.has( dir ) )
		.sort( ( a, b ) => b.length - a.length );
	for ( const dir of removableDirectories ) {
		try {
			await fsPromises.rmdir( path.join( site.path, dir ) );
		} catch ( error ) {
			// Non-empty or already gone — leave it.
		}
	}

	// Build a lookup of on-disk state for skip-unchanged fast pathing.
	const currentByPath = new Map( currentWalk.files.map( ( file ) => [ file.relPath, file ] ) );

	const entries = Object.entries( manifest.files );
	let processed = 0;
	for ( const [ relPath, entry ] of entries ) {
		const destination = path.join( site.path, relPath );

		if ( 'symlink' in entry ) {
			try {
				await fsPromises.rm( destination, { force: true } );
				await fsPromises.mkdir( path.dirname( destination ), { recursive: true } );
				await fsPromises.symlink( entry.symlink, destination );
			} catch ( error ) {
				// Symlink creation can fail on Windows without elevation; warn and
				// continue rather than failing the whole restore.
				console.warn( sprintf( __( 'Could not restore symlink %s; skipping.' ), relPath ) );
			}
		} else {
			const current = currentByPath.get( relPath );
			const unchanged =
				current && current.mtimeMs === entry.mtimeMs && current.size === entry.logicalSize;
			if ( ! unchanged ) {
				await readObjectToFile( site.id, entry, destination, { mode: entry.mode } );
			}
		}

		processed++;
		if ( processed % 500 === 0 ) {
			emitter.emit( CheckpointEvents.CHECKPOINT_RESTORE_PROGRESS, {
				phase: 'files',
				processed,
				total: entries.length,
			} );
		}
	}
}

async function applyDatabase( site: SiteData, manifest: CheckpointManifest ): Promise< void > {
	const databasePath = path.join( site.path, SITE_DATABASE_RELATIVE_PATH );
	await fsPromises.mkdir( path.dirname( databasePath ), { recursive: true } );
	// Remove stale WAL residue so SQLite can't pair the restored main file
	// with frames from the pre-restore database.
	await fsPromises.rm( `${ databasePath }-wal`, { force: true } );
	await fsPromises.rm( `${ databasePath }-shm`, { force: true } );
	await fsPromises.rm( databasePath, { force: true } );
	await readObjectToFile( site.id, manifest.db, databasePath );
}

export async function restoreCheckpoint(
	site: SiteData,
	checkpointId: string,
	logger: Logger< string >,
	options: RestoreCheckpointOptions = {}
): Promise< RestoreCheckpointResult > {
	const emitter = options.emitter ?? new CheckpointEventEmitter();
	let restoreError: unknown;
	let restartError: unknown;
	let wasRunning = false;
	let safetyCheckpointId: string | undefined;

	const manifest = await readCheckpointManifest( site.id, checkpointId );

	// Pin the target before anything else so a concurrent create's prune can't
	// evict it, then fail fast if any object is missing.
	await setCheckpointPinned( site.id, checkpointId, true );

	try {
		await verifyManifestObjects( site.id, manifest );

		emitter.emit( CheckpointEvents.CHECKPOINT_RESTORE_START, {
			siteId: site.id,
			checkpointId,
		} );

		if ( ! options.skipSafetyCheckpoint ) {
			const safetyCheckpoint = await createCheckpoint( site, {
				trigger: 'pre-restore',
				label: sprintf( __( 'Before restoring “%s”' ), manifest.label ?? checkpointId ),
				skipMaintenance: true,
				emitter,
			} );
			safetyCheckpointId = safetyCheckpoint.id;
		}

		await writeRestoreJournal( site.id, {
			version: CHECKPOINT_STORE_VERSION,
			checkpointId,
			safetyCheckpointId,
			startedAt: Date.now(),
		} );

		// Re-check the running state now (after the safety checkpoint) — the
		// user or an agent could have started or stopped the site meanwhile.
		wasRunning = !! ( await isServerRunning( site.id ) );
		if ( wasRunning ) {
			await stopWordPressServer( site.id );
			await clearSiteLatestCliPid( site.id );
		}

		emitter.emit( CheckpointEvents.CHECKPOINT_RESTORE_PROGRESS, { phase: 'files' } );
		await applyFiles( site, manifest, emitter );

		emitter.emit( CheckpointEvents.CHECKPOINT_RESTORE_PROGRESS, { phase: 'database' } );
		await applyDatabase( site, manifest );

		emitter.emit( CheckpointEvents.CHECKPOINT_RESTORE_PROGRESS, { phase: 'finalizing' } );
		await keepSqliteIntegrationUpdated( site.path );

		if ( manifest.phpVersion && manifest.phpVersion !== site.phpVersion ) {
			await updateSitePhpVersion( site.id, manifest.phpVersion );
			site.phpVersion = manifest.phpVersion;
		}

		// Serialization-aware search-replace fixes any port/URL drift between
		// checkpoint time and now. Runs via wp-cli while the site is stopped.
		await updateSiteUrl( site );

		await removeRestoreJournal( site.id );

		emitter.emit( CheckpointEvents.CHECKPOINT_RESTORE_COMPLETE, {
			checkpointId,
			siteId: site.id,
		} );
	} catch ( error ) {
		restoreError = error;
		emitter.emit( CheckpointEvents.CHECKPOINT_RESTORE_ERROR, {
			message: error instanceof Error ? error.message : String( error ),
		} );
	} finally {
		try {
			if ( wasRunning && ! restoreError ) {
				await startWordPressServer( site, logger );
				// Prime the site: the first request after a Playground start can
				// return a transient error page.
				const { getSiteUrl } = await import( 'cli/lib/cli-config/sites' );
				await fetch( getSiteUrl( site ) ).catch( () => {} );
			}
		} catch ( error ) {
			restartError = error;
		} finally {
			await setCheckpointPinned( site.id, checkpointId, false ).catch( () => {} );
		}
	}

	if ( restoreError instanceof Error ) {
		throw restoreError;
	}
	if ( restartError instanceof Error ) {
		throw restartError;
	}

	return { checkpointId, safetyCheckpointId };
}

// Returns the journal if the previous restore for this site was interrupted.
export async function findInterruptedRestore( siteId: string ) {
	const { readRestoreJournal } = await import( './manifest' );
	const journal = await readRestoreJournal( siteId );
	return journal;
}

export function siteHasDatabase( site: SiteData ): boolean {
	return fs.existsSync( path.join( site.path, SITE_DATABASE_RELATIVE_PATH ) );
}
