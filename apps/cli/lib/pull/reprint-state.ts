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

type ReprintStateSnapshot = z.infer< typeof reprintStateSnapshotSchema >;

function getReprintStatePath( stateDirectory: string ): string {
	return path.join( stateDirectory, STATE_FILE );
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

export function hasSkippedFiles( stateDirectory: string ): boolean {
	const skippedListPath = path.join( stateDirectory, SKIPPED_DOWNLOAD_LIST );
	return fs.existsSync( skippedListPath ) && fs.statSync( skippedListPath ).size > 0;
}
