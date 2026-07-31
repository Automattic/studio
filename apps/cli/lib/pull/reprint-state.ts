/**
 * Paths needed for streaming indexes and the remaining mutations of
 * Reprint-owned pull state.
 */
import fs from 'fs';
import path from 'path';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';

const STATE_FILE = path.join( 'pull', 'state.json' );
const REMOTE_INDEX_FILE = path.join( 'pull', 'remote-index.jsonl' );

export function getReprintStatePath( stateDirectory: string ): string {
	return path.join( stateDirectory, STATE_FILE );
}

export function getRemoteIndexPath( stateDirectory: string ): string {
	return path.join( stateDirectory, REMOTE_INDEX_FILE );
}

function readReprintState( stateDirectory: string ): Record< string, unknown > | null {
	let raw: string;
	try {
		raw = fs.readFileSync( getReprintStatePath( stateDirectory ), 'utf-8' );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			return null;
		}
		throw error;
	}

	return JSON.parse( raw ) as Record< string, unknown >;
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
	mergeReprintStateFields( stateDirectory, ( state ) => {
		state.pull_pipeline = { ...( state.pull_pipeline ?? {} ), skipped_pending: true };
	} );
}

/**
 * Record the SQLite target in reprint's state when the database pull is
 * skipped. `apply-runtime` generates the SQLite runtime section only
 * from the target that `db-apply` persisted; without it the generated
 * runtime has no database configuration and WordPress dies on a
 * database-connection error. Point it at the kept local database.
 */
export function setSqliteRuntimeTarget( stateDirectory: string, sqlitePath: string ): void {
	mergeReprintStateFields( stateDirectory, ( state ) => {
		state.apply = {
			...( state.apply ?? {} ),
			target_engine: 'sqlite',
			target_sqlite_path: sqlitePath,
		};
	} );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mergeReprintStateFields( stateDirectory: string, mutate: ( state: any ) => void ): void {
	/* eslint-enable @typescript-eslint/no-explicit-any */
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
	mutate( state );
	fs.writeFileSync( statePath, JSON.stringify( state, null, 2 ) + '\n' );
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
		path.join( 'pull', 'local-index.jsonl' ),
		path.join( 'pull', 'remote-index.jsonl' ),
		path.join( 'pull', 'fetch-list.jsonl' ),
		path.join( 'pull', 'skipped-fetch-list.jsonl' ),
		'progress.json',
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
