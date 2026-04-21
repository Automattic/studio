/**
 * Accessors for reprint.phar's on-disk state files.
 *
 * reprint.phar writes a JSON progress file (`.import-state.json`) and a
 * JSONL index (`.import-remote-index.jsonl`) under each pull's state
 * directory.  Studio reads those files to decide whether to resume or
 * restart a phase, repair blocking paths, detect stale layouts, etc.
 *
 * This module is the single seam where Studio couples to reprint's
 * internal schema.  When reprint renames a field or moves data around,
 * the fix is scoped to this file — every other caller goes through
 * these accessors.
 */
import fs from 'fs';
import path from 'path';

const STATE_FILE = '.import-state.json';
const REMOTE_INDEX_FILE = '.import-remote-index.jsonl';
export const SKIPPED_DOWNLOAD_LIST = '.import-download-list-skipped.jsonl';

export interface ReprintStateSnapshot {
	command?: string | null;
	status?: string | null;
	cursor?: unknown;
	stage?: string | null;
	preflight?: {
		data?: {
			runtime?: {
				document_root?: string | null;
			};
		};
	};
}

export function getReprintStatePath( stateDirectory: string ): string {
	return path.join( stateDirectory, STATE_FILE );
}

export function getRemoteIndexPath( stateDirectory: string ): string {
	return path.join( stateDirectory, REMOTE_INDEX_FILE );
}

export function readReprintState( stateDirectory: string ): ReprintStateSnapshot | null {
	let raw: string;
	try {
		raw = fs.readFileSync( getReprintStatePath( stateDirectory ), 'utf-8' );
	} catch ( error: unknown ) {
		if ( ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) {
			return null;
		}
		throw error;
	}

	return JSON.parse( raw ) as ReprintStateSnapshot;
}

/**
 * reprint represents filesystem paths in its state as either plain
 * strings or "base64:..." when the path contains characters that
 * would otherwise need escaping in JSON.  Studio consumes both.
 */
function decodeReprintStatePath( value: string | null | undefined ): string | null {
	if ( ! value ) {
		return null;
	}

	if ( ! value.startsWith( 'base64:' ) ) {
		return value;
	}

	try {
		return Buffer.from( value.slice( 'base64:'.length ), 'base64' ).toString( 'utf8' );
	} catch {
		return null;
	}
}

/**
 * Read the remote WP_CONTENT_DIR path from the reprint state's
 * preflight data.  This is the absolute path on the source server
 * (e.g. "/srv/htdocs/wp-content"), which mirrors the directory layout
 * inside the raw fs-root.
 */
export function getContentDirFromState( stateDirectory: string ): string | null {
	const state = readReprintState( stateDirectory ) as
		| ( ReprintStateSnapshot & Record< string, unknown > )
		| null;
	const preflight = state?.preflight?.data as Record< string, unknown > | undefined;
	const database = preflight?.database as Record< string, unknown > | undefined;
	const wp = database?.wp as Record< string, unknown > | undefined;
	const pathsUrls = wp?.paths_urls as Record< string, unknown > | undefined;
	const contentDir = pathsUrls?.content_dir;
	return typeof contentDir === 'string' ? contentDir : null;
}

/**
 * Collect the top-level directory names that reprint's preflight said
 * must exist inside the raw fs-root.  These are derived from the
 * remote site's WP detection roots and core path constants.
 */
function getRequiredRawRootDirectoryNames( stateDirectory: string ): string[] {
	const state = readReprintState( stateDirectory ) as
		| ( ReprintStateSnapshot & Record< string, unknown > )
		| null;
	const preflight = state?.preflight?.data as Record< string, unknown > | undefined;
	const wpDetect = preflight?.wp_detect as Record< string, unknown > | undefined;
	const runtime = preflight?.runtime as Record< string, unknown > | undefined;
	const constantValues = runtime?.constant_values as Record< string, unknown > | undefined;
	const roots = Array.isArray( wpDetect?.roots ) ? wpDetect.roots : [];

	const paths = roots
		.map( ( root ) => {
			if ( ! root || typeof root !== 'object' || Array.isArray( root ) ) {
				return null;
			}

			return decodeReprintStatePath( typeof root.path === 'string' ? root.path : null );
		} )
		.concat(
			[
				constantValues?.ABSPATH,
				constantValues?.WP_CONTENT_DIR,
				constantValues?.WP_PLUGIN_DIR,
				constantValues?.WPMU_PLUGIN_DIR,
				constantValues?.TEMPLATEPATH,
				constantValues?.STYLESHEETPATH,
			].map( ( value ) => ( typeof value === 'string' ? value : null ) )
		)
		.filter( ( value ): value is string => Boolean( value && value.startsWith( '/' ) ) );

	return [ ...new Set( paths.map( ( value ) => value.replace( /^\/+/, '' ).split( '/' )[ 0 ] ) ) ];
}

/**
 * When reprint's on-disk layout gets corrupted (e.g. a core directory
 * was left behind as a file instead of a directory), this clears the
 * blocking entries so the next files-sync can re-create them cleanly.
 * Returns the list of paths it had to remove.
 */
export function repairBlockingRawPullPaths(
	stateDirectory: string,
	rawDirectory: string
): string[] {
	const repairedPaths: string[] = [];

	for ( const directoryName of getRequiredRawRootDirectoryNames( stateDirectory ) ) {
		const blockedPath = path.join( rawDirectory, directoryName );
		if ( ! fs.existsSync( blockedPath ) ) {
			continue;
		}

		try {
			if ( fs.statSync( blockedPath ).isDirectory() ) {
				continue;
			}
		} catch {
			// Broken symlinks and unreadable paths must be repaired below.
		}

		fs.rmSync( blockedPath, { recursive: true, force: true } );
		repairedPaths.push( blockedPath );
	}

	return repairedPaths;
}

/**
 * True when the reprint state says files-sync indexing started but
 * didn't get far enough to checkpoint a cursor — in that case the
 * next run must restart indexing from scratch rather than trying to
 * resume from a non-existent cursor.
 */
export function shouldRestartFilesSyncIndex( stateDirectory: string ): boolean {
	const state = readReprintState( stateDirectory );
	if ( ! state ) {
		return false;
	}

	if ( state.command !== 'files-sync' || state.status === 'complete' ) {
		return false;
	}

	if ( state.stage !== 'index' || state.cursor !== null ) {
		return false;
	}

	const remoteIndexPath = getRemoteIndexPath( stateDirectory );
	return fs.existsSync( remoteIndexPath ) && fs.statSync( remoteIndexPath ).size > 0;
}

export function hasSkippedFiles( stateDirectory: string ): boolean {
	const skippedListPath = path.join( stateDirectory, SKIPPED_DOWNLOAD_LIST );
	return fs.existsSync( skippedListPath ) && fs.statSync( skippedListPath ).size > 0;
}

/**
 * Wipe the reprint state + derived indexes so the next run starts an
 * essential-files sync from scratch — but preserve preflight data so
 * we don't have to round-trip the remote for it again.
 */
export function resetEssentialFilesState( stateDirectory: string ): void {
	const existingState = readReprintState( stateDirectory ) as Record< string, unknown > | null;
	const preflight = existingState?.preflight;

	for ( const fileName of [
		'.import-index.jsonl',
		'.import-remote-index.jsonl',
		'.import-download-list.jsonl',
		'.import-download-list-skipped.jsonl',
		'.import-status.json',
	] ) {
		fs.rmSync( path.join( stateDirectory, fileName ), { force: true } );
	}

	const statePath = getReprintStatePath( stateDirectory );
	if ( preflight ) {
		fs.writeFileSync( statePath, JSON.stringify( { preflight }, null, 2 ) + '\n' );
	} else {
		fs.rmSync( statePath, { force: true } );
	}
}
