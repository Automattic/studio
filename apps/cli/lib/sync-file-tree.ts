import fs from 'fs';
import nodePath from 'path';
import { shouldExcludeFromSync, shouldLimitDepth } from '@studio/common/lib/sync/tree-utils';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';

export async function listLocalFileTree(
	sitePath: string,
	relativePath: string,
	maxDepth: number = 2,
	currentDepth: number = 0
): Promise< RawDirectoryEntry[] > {
	const fullPath = nodePath.join( sitePath, relativePath );

	try {
		const entries = await fs.promises.readdir( fullPath, { withFileTypes: true } );
		const result: RawDirectoryEntry[] = [];

		for ( const entry of entries ) {
			if ( shouldExcludeFromSync( entry.name ) ) {
				continue;
			}

			const isDirectory = entry.isDirectory();
			const itemPath = nodePath.join( relativePath, entry.name ).replace( /\\/g, '/' );

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
						currentDepth + 1
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
