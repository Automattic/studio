import fsPromises from 'fs/promises';
import path from 'path';
import {
	isExactPathExcluded,
	isExcludedDirectoryName,
} from 'cli/lib/import-export/export/exporters/path-exclusions';
import type { CheckpointManifest } from './manifest';

// Temp files the checkpoint engine itself writes into the site root during
// database capture; never part of a checkpoint.
export const CHECKPOINT_TEMP_FILE_PREFIX = '.studio-checkpoint-';

export interface WalkedFile {
	// `/`-normalized path relative to the site root.
	relPath: string;
	fullPath: string;
	size: number;
	mtimeMs: number;
	mode: number;
}

export interface WalkedSymlink {
	relPath: string;
	target: string;
}

export interface WalkResult {
	files: WalkedFile[];
	symlinks: WalkedSymlink[];
	// All directories visited (`/`-normalized, relative), deepest last. Used
	// by restore to prune directories that shouldn't exist in the target
	// state, including empty ones the file list can't reveal.
	directories: string[];
}

function toPosix( relPath: string ): string {
	return relPath.split( path.sep ).join( '/' );
}

// Walks the site tree producing checkpoint entries. Applies the shared
// export/checkpoint exclusions. Symlinks are recorded, never followed.
export async function walkSite( sitePath: string ): Promise< WalkResult > {
	const files: WalkedFile[] = [];
	const symlinks: WalkedSymlink[] = [];
	const directories: string[] = [];

	async function walkDirectory( currentPath: string ): Promise< void > {
		const entries = await fsPromises.readdir( currentPath, { withFileTypes: true } );
		for ( const entry of entries ) {
			const fullPath = path.join( currentPath, entry.name );
			const relPath = path.relative( sitePath, fullPath );
			const posixRelPath = toPosix( relPath );

			if ( entry.isDirectory() ) {
				if ( isExcludedDirectoryName( entry.name ) || isExactPathExcluded( relPath ) ) {
					continue;
				}
				directories.push( posixRelPath );
				await walkDirectory( fullPath );
				continue;
			}

			if ( isExactPathExcluded( relPath ) ) {
				continue;
			}
			if ( entry.name.startsWith( CHECKPOINT_TEMP_FILE_PREFIX ) ) {
				continue;
			}

			if ( entry.isSymbolicLink() ) {
				try {
					const target = await fsPromises.readlink( fullPath );
					symlinks.push( { relPath: posixRelPath, target } );
				} catch ( error ) {
					// Broken link readback; skip it rather than fail the walk.
				}
				continue;
			}

			if ( ! entry.isFile() ) {
				continue;
			}

			try {
				const stat = await fsPromises.lstat( fullPath );
				files.push( {
					relPath: posixRelPath,
					fullPath,
					size: stat.size,
					mtimeMs: stat.mtimeMs,
					mode: stat.mode & 0o777,
				} );
			} catch ( error ) {
				// The file disappeared between readdir and lstat (running site);
				// captures are best-effort for in-flight file churn.
			}
		}
	}

	await walkDirectory( sitePath );
	return { files, symlinks, directories };
}

// Returns true when a walked file can reuse the previous manifest's object
// without re-hashing: same size and mtime (git-index trick). A restored or
// touched file re-hashes; only genuinely unchanged files skip.
export function canReusePreviousEntry(
	file: WalkedFile,
	previousManifest: CheckpointManifest | undefined
): { hash: string; size: number; z: boolean } | undefined {
	const previous = previousManifest?.files[ file.relPath ];
	if ( ! previous || ! ( 'hash' in previous ) ) {
		return undefined;
	}
	if ( previous.mtimeMs === file.mtimeMs && previous.logicalSize === file.size ) {
		return { hash: previous.hash, size: previous.size, z: previous.z };
	}
	return undefined;
}
