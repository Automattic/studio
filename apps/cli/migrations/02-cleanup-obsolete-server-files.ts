/**
 * Removes entries in `~/.studio/server-files/` that were written by older CLI versions
 * but are no longer used — those dependencies are now read directly from the bundled
 * `wp-files/` directory instead.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import type { Migration } from '@studio/common/lib/migration';

const OBSOLETE_ENTRIES = [
	'skills',
	'language-packs',
	'phpmyadmin',
	'sqlite-database-integration',
	'sqlite-command',
	'wp-cli.phar',
];

function getObsoletePaths(): string[] {
	const serverFilesPath = getServerFilesPath();
	return OBSOLETE_ENTRIES.map( ( name ) => path.join( serverFilesPath, name ) );
}

export const cleanupObsoleteServerFiles: Migration = {
	needsToRun: async () => getObsoletePaths().some( ( p ) => fs.existsSync( p ) ),
	run: async () => {
		const results = await Promise.allSettled(
			getObsoletePaths().map( ( p ) => fs.promises.rm( p, { recursive: true, force: true } ) )
		);
		for ( const result of results ) {
			if ( result.status === 'rejected' ) {
				console.error( '[migration] Failed to remove obsolete server-files entry:', result.reason );
			}
		}
	},
};
