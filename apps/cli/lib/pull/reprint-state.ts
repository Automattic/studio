/**
 * Accessors for reprint.phar's on-disk state files.
 *
 * reprint.phar writes a JSON progress file (`.import-state.json`) and a
 * JSONL index (`.import-remote-index.jsonl`) under each pull's state
 * directory.  Studio reads those files to decide whether to resume or
 * restart a phase, detect stale layouts, etc.
 *
 * This module is the single seam where Studio couples to reprint's
 * internal schema.  When reprint renames a field or moves data around,
 * the fix is scoped to this file — every other caller goes through
 * these accessors.
 */
import fs from 'fs';
import path from 'path';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { z } from 'zod';

const STATE_FILE = '.import-state.json';
const REMOTE_INDEX_FILE = '.import-remote-index.jsonl';
const LOCAL_INDEX_FILE = '.import-index.jsonl';
export const SKIPPED_DOWNLOAD_LIST = '.import-download-list-skipped.jsonl';

export const reprintStateSnapshotSchema = z.looseObject( {
	command: z.string().nullish(),
	status: z.string().nullish(),
	cursor: z.unknown().optional(),
	stage: z.string().nullish(),
	filter: z.string().nullish(),
	// Typed-state schema (reprint ≥ v0.9 trunk): the resumable-command
	// checkpoint lives in a nested object instead of the flat legacy fields.
	active_resumable_command: z
		.looseObject( {
			command_name: z.string().nullish(),
			completion_state: z.string().nullish(),
			current_stage: z.string().nullish(),
			remote_cursor: z.string().nullish(),
		} )
		.optional(),
	preflight: z
		.looseObject( {
			data: z
				.looseObject( {
					runtime: z
						.looseObject( {
							document_root: z.string().nullish(),
						} )
						.optional(),
				} )
				.optional(),
		} )
		.optional(),
} );

export type ReprintStateSnapshot = z.infer< typeof reprintStateSnapshotSchema >;

/**
 * The active resumable-command checkpoint: the nested
 * `active_resumable_command` object (reprint trunk), falling back to the
 * flat legacy fields.
 */
export function getActiveCommand( state: ReprintStateSnapshot | null ): {
	commandName: string | null;
	completionState: string | null;
	currentStage: string | null;
} {
	const nested = state?.active_resumable_command;
	return {
		commandName: nested?.command_name ?? state?.command ?? null,
		completionState: nested?.completion_state ?? state?.status ?? null,
		currentStage: nested?.current_stage ?? state?.stage ?? null,
	};
}

/**
 * Set the active resumable-command checkpoint, writing both the nested
 * typed-state object and the flat legacy fields so old and new reprint
 * versions alike accept the result.
 */
export function withActiveCommand(
	state: ReprintStateSnapshot | null,
	next: { commandName: string; completionState: string; currentStage: string | null }
): ReprintStateSnapshot {
	return {
		...( state ?? {} ),
		command: next.commandName,
		status: next.completionState,
		stage: next.currentStage,
		active_resumable_command: {
			...( state?.active_resumable_command ?? {} ),
			command_name: next.commandName,
			completion_state: next.completionState,
			current_stage: next.currentStage,
		},
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

export function writeReprintState( stateDirectory: string, state: ReprintStateSnapshot ): void {
	const parsedState = reprintStateSnapshotSchema.parse( state );
	fs.writeFileSync(
		getReprintStatePath( stateDirectory ),
		JSON.stringify( parsedState, null, 2 ) + '\n'
	);
}

/**
 * Read the remote WP_CONTENT_DIR path from the reprint state's
 * preflight data.  This is the absolute path on the source server
 * (e.g. "/srv/htdocs/wp-content"), which mirrors the directory layout
 * inside the raw fs-root.
 */
export function getContentDirFromState( stateDirectory: string ): string | null {
	const state = readReprintState( stateDirectory );
	const preflight = state?.preflight?.data as Record< string, unknown > | undefined;
	const database = preflight?.database as Record< string, unknown > | undefined;
	const wp = database?.wp as Record< string, unknown > | undefined;
	const pathsUrls = wp?.paths_urls as Record< string, unknown > | undefined;
	const contentDir = pathsUrls?.content_dir;
	return typeof contentDir === 'string' ? contentDir : null;
}

/**
 * True when the reprint state says files-sync indexing started but
 * didn't get far enough to checkpoint a cursor — in that case the
 * next run must restart indexing from scratch rather than trying to
 * resume from a non-existent cursor.
 *
 * This handles a real crash-recovery scenario: the user kills the
 * process (Ctrl-C, laptop sleep, OOM) during the first indexing
 * pass before reprint writes its first cursor checkpoint. Reprint
 * itself doesn't auto-detect this — it needs the caller to send
 * `files-sync --abort` first to clear the broken state. Studio
 * detects the condition here so pull-reprint can issue that abort
 * automatically before retrying.
 */
export function shouldRestartFilesSyncIndex( stateDirectory: string ): boolean {
	const state = readReprintState( stateDirectory );
	if ( ! state ) {
		return false;
	}

	// reprint canonicalizes the legacy 'files-sync' command name to
	// 'files-pull' when it saves state; accept both so this check keeps
	// working across reprint versions.
	const { commandName, completionState, currentStage } = getActiveCommand( state );
	if (
		( commandName !== 'files-sync' && commandName !== 'files-pull' ) ||
		completionState === 'complete'
	) {
		return false;
	}

	const cursor = state.active_resumable_command?.remote_cursor ?? state.cursor ?? null;
	if ( currentStage !== 'index' || cursor !== null ) {
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
		writeReprintState( stateDirectory, { preflight } );
	} else {
		fs.rmSync( statePath, { force: true } );
	}
}
