import crypto from 'crypto';
import fsPromises from 'fs/promises';
import path from 'path';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { captureDatabase } from './capture-database';
import { getStoreTmpDirectory, readCheckpointManifest, type CheckpointManifest } from './manifest';
import { readObjectToFile } from './store';
import { walkSite } from './walker';
import type { SiteData } from 'cli/lib/cli-config/core';

export interface FileDiffEntry {
	path: string;
	size?: number;
}

export interface CheckpointDiff {
	from: string;
	to: string;
	files: {
		added: FileDiffEntry[];
		modified: FileDiffEntry[];
		deleted: FileDiffEntry[];
	};
	database: {
		// False when node:sqlite is unavailable; only size info is provided.
		detailed: boolean;
		sizeDelta?: number;
		changedTables?: Array< { table: string; fromRows: number; toRows: number } >;
		addedTables?: string[];
		removedTables?: string[];
		changedOptions?: string[];
	};
}

interface ComparableState {
	// path → { mtimeMs, logicalSize, hash? }
	files: Map< string, { mtimeMs: number; logicalSize: number; hash?: string } >;
	symlinks: Map< string, string >;
}

function manifestToComparable( manifest: CheckpointManifest ): ComparableState {
	const files = new Map< string, { mtimeMs: number; logicalSize: number; hash?: string } >();
	const symlinks = new Map< string, string >();
	for ( const [ relPath, entry ] of Object.entries( manifest.files ) ) {
		if ( 'symlink' in entry ) {
			symlinks.set( relPath, entry.symlink );
		} else {
			files.set( relPath, {
				mtimeMs: entry.mtimeMs,
				logicalSize: entry.logicalSize,
				hash: entry.hash,
			} );
		}
	}
	return { files, symlinks };
}

async function siteToComparable( site: SiteData ): Promise< ComparableState > {
	const walk = await walkSite( site.path );
	return {
		files: new Map(
			walk.files.map( ( file ) => [
				file.relPath,
				{ mtimeMs: file.mtimeMs, logicalSize: file.size },
			] )
		),
		symlinks: new Map( walk.symlinks.map( ( link ) => [ link.relPath, link.target ] ) ),
	};
}

function diffStates( from: ComparableState, to: ComparableState ): CheckpointDiff[ 'files' ] {
	const added: FileDiffEntry[] = [];
	const modified: FileDiffEntry[] = [];
	const deleted: FileDiffEntry[] = [];

	for ( const [ relPath, toEntry ] of to.files ) {
		const fromEntry = from.files.get( relPath );
		if ( ! fromEntry ) {
			added.push( { path: relPath, size: toEntry.logicalSize } );
			continue;
		}
		// When both sides carry content hashes, compare those; otherwise fall
		// back to mtime+size (sufficient for "what changed" summaries).
		const sameContent =
			fromEntry.hash && toEntry.hash
				? fromEntry.hash === toEntry.hash
				: fromEntry.mtimeMs === toEntry.mtimeMs && fromEntry.logicalSize === toEntry.logicalSize;
		if ( ! sameContent ) {
			modified.push( { path: relPath, size: toEntry.logicalSize } );
		}
	}
	for ( const relPath of from.files.keys() ) {
		if ( ! to.files.has( relPath ) ) {
			deleted.push( { path: relPath } );
		}
	}
	for ( const [ relPath, target ] of to.symlinks ) {
		if ( ! from.symlinks.has( relPath ) ) {
			added.push( { path: relPath } );
		} else if ( from.symlinks.get( relPath ) !== target ) {
			modified.push( { path: relPath } );
		}
	}
	for ( const relPath of from.symlinks.keys() ) {
		if ( ! to.symlinks.has( relPath ) ) {
			deleted.push( { path: relPath } );
		}
	}

	const byPath = ( a: FileDiffEntry, b: FileDiffEntry ) => a.path.localeCompare( b.path );
	added.sort( byPath );
	modified.sort( byPath );
	deleted.sort( byPath );
	return { added, modified, deleted };
}

interface SqliteDatabase {
	prepare( sql: string ): {
		all( ...params: unknown[] ): Array< Record< string, unknown > >;
		get( ...params: unknown[] ): Record< string, unknown > | undefined;
	};
	close(): void;
}

async function openSqliteReadonly( filePath: string ): Promise< SqliteDatabase | undefined > {
	try {
		const sqlite = await import( 'node:sqlite' );
		return new sqlite.DatabaseSync( filePath, { readOnly: true } ) as unknown as SqliteDatabase;
	} catch ( error ) {
		return undefined;
	}
}

function readTableRowCounts( db: SqliteDatabase ): Map< string, number > {
	const counts = new Map< string, number >();
	const tables = db
		.prepare( "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'" )
		.all();
	for ( const row of tables ) {
		const table = String( row.name );
		try {
			const result = db.prepare( `SELECT COUNT(*) AS n FROM "${ table }"` ).get();
			counts.set( table, Number( result?.n ?? 0 ) );
		} catch ( error ) {
			counts.set( table, -1 );
		}
	}
	return counts;
}

// wp_options fingerprint: option name → value length. Cheap to compute and
// catches the changes agents most often make (settings, active plugins).
function readOptionsFingerprint( db: SqliteDatabase ): Map< string, number > | undefined {
	try {
		const rows = db
			.prepare( 'SELECT option_name, LENGTH(option_value) AS len FROM wp_options' )
			.all();
		return new Map( rows.map( ( row ) => [ String( row.option_name ), Number( row.len ) ] ) );
	} catch ( error ) {
		return undefined;
	}
}

async function diffDatabases(
	fromPath: string,
	toPath: string
): Promise< CheckpointDiff[ 'database' ] > {
	const [ fromStat, toStat ] = await Promise.all( [
		fsPromises.stat( fromPath ),
		fsPromises.stat( toPath ),
	] );
	const sizeDelta = toStat.size - fromStat.size;

	const fromDb = await openSqliteReadonly( fromPath );
	const toDb = await openSqliteReadonly( toPath );
	if ( ! fromDb || ! toDb ) {
		fromDb?.close();
		toDb?.close();
		return { detailed: false, sizeDelta };
	}

	try {
		const fromCounts = readTableRowCounts( fromDb );
		const toCounts = readTableRowCounts( toDb );

		const changedTables: Array< { table: string; fromRows: number; toRows: number } > = [];
		const addedTables: string[] = [];
		const removedTables: string[] = [];

		for ( const [ table, toRows ] of toCounts ) {
			if ( ! fromCounts.has( table ) ) {
				addedTables.push( table );
			} else if ( fromCounts.get( table ) !== toRows ) {
				changedTables.push( { table, fromRows: fromCounts.get( table )!, toRows } );
			}
		}
		for ( const table of fromCounts.keys() ) {
			if ( ! toCounts.has( table ) ) {
				removedTables.push( table );
			}
		}

		const changedOptions: string[] = [];
		const fromOptions = readOptionsFingerprint( fromDb );
		const toOptions = readOptionsFingerprint( toDb );
		if ( fromOptions && toOptions ) {
			for ( const [ name, len ] of toOptions ) {
				if ( ! fromOptions.has( name ) || fromOptions.get( name ) !== len ) {
					changedOptions.push( name );
				}
			}
			for ( const name of fromOptions.keys() ) {
				if ( ! toOptions.has( name ) ) {
					changedOptions.push( name );
				}
			}
			changedOptions.sort();
		}

		return {
			detailed: true,
			sizeDelta,
			changedTables,
			addedTables: addedTables.sort(),
			removedTables: removedTables.sort(),
			changedOptions,
		};
	} finally {
		fromDb.close();
		toDb.close();
	}
}

async function materializeDatabase(
	site: SiteData,
	manifest: CheckpointManifest
): Promise< string > {
	const destination = path.join(
		getStoreTmpDirectory( site.id ),
		`diff-${ crypto.randomUUID() }.sqlite`
	);
	await readObjectToFile( site.id, manifest.db, destination );
	return destination;
}

// Diffs two checkpoints, or a checkpoint against the site's current state
// (`toId === 'current'`).
export async function diffCheckpoints(
	site: SiteData,
	fromId: string,
	toId: string | 'current' = 'current'
): Promise< CheckpointDiff > {
	const fromManifest = await readCheckpointManifest( site.id, fromId );
	const cleanupPaths: string[] = [];

	try {
		const fromDbPath = await materializeDatabase( site, fromManifest );
		cleanupPaths.push( fromDbPath );

		let files: CheckpointDiff[ 'files' ];
		let toDbPath: string;

		if ( toId === 'current' ) {
			files = diffStates( manifestToComparable( fromManifest ), await siteToComparable( site ) );
			const isRunning = !! ( await isServerRunning( site.id ) );
			const capture = await captureDatabase( site, isRunning );
			toDbPath = capture.capturedPath;
			cleanupPaths.push( toDbPath );
		} else {
			const toManifest = await readCheckpointManifest( site.id, toId );
			files = diffStates(
				manifestToComparable( fromManifest ),
				manifestToComparable( toManifest )
			);
			toDbPath = await materializeDatabase( site, toManifest );
			cleanupPaths.push( toDbPath );
		}

		const database = await diffDatabases( fromDbPath, toDbPath );

		return { from: fromId, to: toId, files, database };
	} finally {
		for ( const cleanupPath of cleanupPaths ) {
			await fsPromises.rm( cleanupPath, { force: true } );
		}
	}
}
