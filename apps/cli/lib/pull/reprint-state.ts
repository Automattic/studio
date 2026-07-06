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
export const SKIPPED_DOWNLOAD_LIST = '.import-download-list-skipped.jsonl';

export const reprintStateSnapshotSchema = z.looseObject( {
	command: z.string().nullish(),
	status: z.string().nullish(),
	cursor: z.unknown().optional(),
	stage: z.string().nullish(),
	filter: z.string().nullish(),
	preflight: z
		.looseObject( {
			data: z
				.looseObject( {
					runtime: z
						.looseObject( {
							document_root: z.string().nullish(),
						} )
						.optional(),
					database: z
						.looseObject( {
							wp: z
								.looseObject( {
									paths_urls: z
										.looseObject( {
											content_dir: z.string().nullish(),
										} )
										.optional(),
								} )
								.optional(),
						} )
						.optional(),
				} )
				.optional(),
		} )
		.optional(),
} );

export type ReprintStateSnapshot = z.infer< typeof reprintStateSnapshotSchema >;

export function getReprintStatePath( stateDirectory: string ): string {
	return path.join( stateDirectory, STATE_FILE );
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
	const contentDir = state?.preflight?.data?.database?.wp?.paths_urls?.content_dir;
	return typeof contentDir === 'string' ? contentDir : null;
}

export function hasSkippedFiles( stateDirectory: string ): boolean {
	const skippedListPath = path.join( stateDirectory, SKIPPED_DOWNLOAD_LIST );
	return fs.existsSync( skippedListPath ) && fs.statSync( skippedListPath ).size > 0;
}
