// src/ui/publish.ts
//
// `data-liberation publish <dir> --to <target>`: put a liberated site online.
// Operates on what is already on disk, so a target can change, or a repaired
// copy can ship, without touching the source site again.
//
import { existsSync, statSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
	findPublishTarget,
	PublishError,
	publishTargetNames,
	type PublishResult,
} from '../lib/publish/index.js';

export interface PublishCliOptions {
	directory: string;
	target: string;
	token?: string | undefined;
	log?: ( ( message: string ) => void ) | undefined;
}

/**
 * Accept either a liberated site directory or the run directory that contains
 * it. `data-liberation <url>` reports the run directory, so publishing what was
 * just printed should work without the operator appending `website` by hand.
 */
export function resolvePublishDirectory( directory: string ): string {
	const absolute = resolve( directory );
	if ( ! existsSync( absolute ) || ! statSync( absolute ).isDirectory() ) {
		throw new Error( `Not a directory: ${ absolute }` );
	}
	const nested = join( absolute, 'website' );
	if ( existsSync( join( absolute, 'capture-receipt.json' ) ) && existsSync( nested ) ) {
		return nested;
	}
	return absolute;
}

export async function publishSite( options: PublishCliOptions ): Promise< PublishResult > {
	const target = findPublishTarget( options.target );
	if ( ! target ) {
		throw new PublishError( {
			code: 'unknown_target',
			message: `Unknown publish target "${ options.target }". Available: ${ publishTargetNames().join(
				', '
			) }.`,
		} );
	}
	const directory = resolvePublishDirectory(options.directory);
	const staging = target.attribution ? mkdtempSync(join(tmpdir(), 'dla-publish-')) : undefined;
	try {
		if (staging) {
			cpSync(directory, staging, { recursive: true, dereference: true });
			await target.attribution!({ directory: staging });
		}
		return await target.publish( {
			directory: staging ?? directory,
			token: options.token,
			log: options.log,
		} );
	} finally { if (staging) rmSync(staging, { recursive: true, force: true }); }
}
