/**
 * Accessors for reprint.phar's on-disk state files.
 *
 * reprint.phar writes a JSON progress file (`.import-state.json`) and a
 * skipped-download list under each pull's state directory. Studio reads
 * only the fields it needs to wire the imported runtime and decide
 * whether to invoke the follow-up skipped-files sync.
 *
 * This module is the single place where Studio couples to reprint's
 * on-disk output. Reprint owns its own state machine.
 */
import fs from 'fs';
import path from 'path';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { z } from 'zod';

const STATE_FILE = '.import-state.json';
const REMOTE_INDEX_FILE = '.import-remote-index.jsonl';
const LOCAL_INDEX_FILE = '.import-index.jsonl';
const SKIPPED_DOWNLOAD_LIST = '.import-download-list-skipped.jsonl';

const reprintStateSnapshotSchema = z.looseObject( {
	preflight: z
		.looseObject( {
			data: z
				.looseObject( {
					database: z
						.looseObject( {
							wp: z
								.looseObject( {
									table_prefix: z.string().nullish(),
									paths_urls: z
										.looseObject( {
											content_dir: z.string().nullish(),
											abspath: z.string().nullish(),
										} )
										.optional(),
								} )
								.optional(),
						} )
						.optional(),
					wp_detect: z
						.looseObject( {
							roots: z.array( z.looseObject( { path: z.string().nullish() } ) ).optional(),
						} )
						.optional(),
				} )
				.optional(),
		} )
		.optional(),
} );

type ReprintStateSnapshot = z.infer< typeof reprintStateSnapshotSchema >;

function getReprintStatePath( stateDirectory: string ): string {
	return path.join( stateDirectory, STATE_FILE );
}

export function getRemoteIndexPath( stateDirectory: string ): string {
	return path.join( stateDirectory, REMOTE_INDEX_FILE );
}

function readReprintState( stateDirectory: string ): ReprintStateSnapshot | null {
	let raw: string;
	try {
		raw = fs.readFileSync( getReprintStatePath( stateDirectory ), 'utf-8' );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return null;
		}
		throw error;
	}

	const parsedJson = JSON.parse( raw );
	const parsed = reprintStateSnapshotSchema.safeParse( parsedJson );
	return parsed.success ? parsed.data : null;
}

/**
 * Read the remote WP_CONTENT_DIR path from the reprint state's
 * preflight data.  This is the absolute path on the source server
 * (e.g. "/srv/htdocs/wp-content"), which mirrors the directory layout
 * inside the raw fs-root.
 */
export function getContentDirFromState( stateDirectory: string ): string | null {
	const state = readReprintState( stateDirectory );
	const contentDir = state?.preflight?.data?.database?.wp?.paths_urls?.content_dir;
	return typeof contentDir === 'string' ? contentDir : null;
}

/**
 * Read the remote WordPress ABSPATH from the reprint state's preflight
 * data (e.g. "/wordpress/core/7.0" on WP Cloud).
 */
export function getAbspathFromState( stateDirectory: string ): string | null {
	const state = readReprintState( stateDirectory );
	const abspath = state?.preflight?.data?.database?.wp?.paths_urls?.abspath;
	return typeof abspath === 'string' && abspath !== '' ? decodeStatePath( abspath ) : null;
}

/**
 * Read the remote site's database table prefix from the reprint state's
 * preflight data.
 */
export function getTablePrefixFromState( stateDirectory: string ): string | null {
	const state = readReprintState( stateDirectory );
	const tablePrefix = state?.preflight?.data?.database?.wp?.table_prefix;
	return typeof tablePrefix === 'string' && tablePrefix !== '' ? tablePrefix : null;
}

/**
 * reprint base64-encodes some path fields when persisting its state
 * (`wp_detect` roots among them), marked with a `base64:` prefix; plain
 * values pass through for backward compatibility.
 */
function decodeStatePath( value: string ): string {
	const prefix = 'base64:';
	if ( ! value.startsWith( prefix ) ) {
		return value;
	}
	return Buffer.from( value.slice( prefix.length ), 'base64' ).toString( 'utf-8' );
}

/**
 * Read the WordPress core roots the remote preflight detected (e.g.
 * `/wordpress/core/7.0` and `/wordpress/core` on WP Cloud). A
 * `--only`-scoped pull must pass these explicitly: `--only` *replaces*
 * reprint's default export roots, so without them a partial selection
 * would drop WordPress core and the site could not be assembled.
 */
export function getCoreRootsFromState( stateDirectory: string ): string[] {
	const state = readReprintState( stateDirectory );
	const roots = state?.preflight?.data?.wp_detect?.roots ?? [];
	return roots
		.map( ( root ) => root.path )
		.filter( ( rootPath ): rootPath is string => typeof rootPath === 'string' && rootPath !== '' )
		.map( decodeStatePath );
}

export function hasSkippedFiles( stateDirectory: string ): boolean {
	const skippedListPath = path.join( stateDirectory, SKIPPED_DOWNLOAD_LIST );
	return fs.existsSync( skippedListPath ) && fs.statSync( skippedListPath ).size > 0;
}

/**
 * Restore reprint's `pull_pipeline.skipped_pending` flag before the
 * standalone skipped-earlier tail. `pull-files` sets the flag when it
 * defers the media library, but Studio runs `pull-db` as a separate
 * composite command (so the database can be skipped), and its
 * prepare_repull() resets the flag along with the rest of the pipeline
 * checkpoint. `files-sync --filter=skipped-earlier` keys its recovery
 * on that flag; without it the tail is rejected with "no completed sync
 * with skipped files". Unnecessary once reprint folds the tail into
 * `pull-files` itself.
 */
export function markSkippedFilesPending( stateDirectory: string ): void {
	const statePath = getReprintStatePath( stateDirectory );
	let raw: string;
	try {
		raw = fs.readFileSync( statePath, 'utf-8' );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return;
		}
		throw error;
	}

	const state = JSON.parse( raw );
	state.pull_pipeline = { ...( state.pull_pipeline ?? {} ), skipped_pending: true };
	fs.writeFileSync( statePath, JSON.stringify( state, null, 2 ) + '\n' );
}

/**
 * True when reprint's local file index says a file sync completed, so the
 * raw fs-root holds the site (WordPress core included) and a
 * `--only`-restricted delta pull is safe. Unlike the durable
 * `site.importComplete` flag, this reflects the actual scratch contents.
 */
export function hasLocalFilesIndex( stateDirectory: string ): boolean {
	const localIndexPath = path.join( stateDirectory, LOCAL_INDEX_FILE );
	return fs.existsSync( localIndexPath ) && fs.statSync( localIndexPath ).size > 0;
}

/**
 * Wipe the reprint state + derived indexes so the next run starts an
 * essential-files sync from scratch — but preserve preflight data so
 * we don't have to round-trip the remote for it again.
 */
export function resetEssentialFilesState( stateDirectory: string ): void {
	const existingState = readReprintState( stateDirectory );
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
