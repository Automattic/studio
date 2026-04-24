import fs from 'fs';
import nodePath from 'path';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { SYNC_IGNORE_DEFAULTS } from '@studio/common/lib/sync/constants';
import { shouldExcludeFromSync } from '@studio/common/lib/sync/exclude-from-sync';
import { shouldLimitDepth } from '@studio/common/lib/sync/tree-utils';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';
import type { Ignore } from 'ignore';

export async function listLocalFileTree(
	sitePath: string,
	relativePath: string,
	maxDepth: number = 2,
	currentDepth: number = 0,
	deployIgnore?: Ignore
): Promise< RawDirectoryEntry[] > {
	if ( ! deployIgnore ) {
		deployIgnore = await createDeployIgnoreFilter( sitePath, SYNC_IGNORE_DEFAULTS );
	}

	const fullPath = nodePath.join( sitePath, relativePath );

	try {
		const entries = await fs.promises.readdir( fullPath, { withFileTypes: true } );
		const result: RawDirectoryEntry[] = [];

		for ( const entry of entries ) {
			const itemPath = nodePath.join( relativePath, entry.name ).replace( /\\/g, '/' );

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
				} catch {
					directoryEntry.children = [];
				}
			}

			result.push( directoryEntry );
		}

		return result;
	} catch {
		return [];
	}
}
