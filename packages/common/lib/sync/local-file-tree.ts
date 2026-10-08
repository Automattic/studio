import fs from 'node:fs';
import nodePath from 'node:path';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { SYNC_IGNORE_DEFAULTS } from '@studio/common/lib/sync/constants';
import { shouldExcludeFromSync } from '@studio/common/lib/sync/exclude-from-sync';
import { shouldLimitDepth } from '@studio/common/lib/sync/tree-utils';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';
import type { Ignore } from 'ignore';

/**
 * The site's files under `path` (relative to the site), as the push dialog's
 * selective-sync tree shows them: entries excluded from sync are left out, and
 * directories are expanded up to `maxDepth` levels.
 */
export async function listLocalFileTree(
	sitePath: string,
	path: string,
	maxDepth: number = 3,
	currentDepth: number = 0,
	deployIgnore?: Ignore
): Promise< RawDirectoryEntry[] > {
	if ( ! deployIgnore ) {
		deployIgnore = await createDeployIgnoreFilter( sitePath, SYNC_IGNORE_DEFAULTS );
	}

	const fullPath = nodePath.join( sitePath, path );

	try {
		const entries = await fs.promises.readdir( fullPath, { withFileTypes: true } );
		const result = [];

		for ( const entry of entries ) {
			const itemPath = nodePath.join( path, entry.name ).replace( /\\/g, '/' );

			if ( shouldExcludeFromSync( itemPath, deployIgnore ) ) {
				continue;
			}

			const isDirectory = entry.isDirectory();

			const directoryEntry: RawDirectoryEntry = {
				name: entry.name,
				isDirectory,
				path: itemPath,
			};

			const shouldLimit = shouldLimitDepth( itemPath );
			if ( isDirectory && currentDepth < maxDepth && ! shouldLimit ) {
				try {
					directoryEntry.children = await listLocalFileTree(
						sitePath,
						itemPath,
						maxDepth,
						currentDepth + 1,
						deployIgnore
					);
				} catch ( childErr ) {
					console.warn( `Failed to load children for ${ itemPath }:`, childErr );
					directoryEntry.children = [];
				}
			}

			result.push( directoryEntry );
		}

		return result;
	} catch ( err ) {
		console.error( `Failed to list raw file tree for path ${ path }:`, err );
		return [];
	}
}

// Dangling symlinks and unreadable entries are skipped when archiving, so they
// count as zero rather than failing the size check.
export function getLocalFileSize( fullPath: string ): number {
	try {
		return fs.statSync( fullPath ).size;
	} catch ( error ) {
		console.warn( `Skipping ${ fullPath }: ${ error }` );
		return 0;
	}
}
