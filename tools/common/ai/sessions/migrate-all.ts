// Eager one-shot migration of legacy session JSONL at app launch.
// Idempotent — pi-format files are skipped.

import fs from 'fs/promises';
import path from 'path';
import { migrateLegacyFileInPlace } from './migration';

async function listJsonlFiles( directory: string ): Promise< string[] > {
	let entries;
	try {
		entries = await fs.readdir( directory, { withFileTypes: true, encoding: 'utf8' } );
	} catch ( error ) {
		if ( ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) return [];
		throw error;
	}
	const nested = await Promise.all(
		entries.map( async ( entry ) => {
			const fullPath = path.join( directory, entry.name );
			if ( entry.isDirectory() ) return listJsonlFiles( fullPath );
			if ( entry.isFile() && entry.name.endsWith( '.jsonl' ) ) return [ fullPath ];
			return [];
		} )
	);
	return nested.flat();
}

export interface MigrateAllResult {
	migrated: number;
	skipped: number;
	failed: Array< { filePath: string; reason: string } >;
}

export async function migrateAllSessions(
	rootDirectory: string,
	cwd: string
): Promise< MigrateAllResult > {
	const files = await listJsonlFiles( rootDirectory );
	const result: MigrateAllResult = { migrated: 0, skipped: 0, failed: [] };

	for ( const filePath of files ) {
		try {
			const before = await fs.stat( filePath );
			await migrateLegacyFileInPlace( filePath, cwd );
			const after = await fs.stat( filePath );
			if ( after.mtimeMs !== before.mtimeMs ) {
				result.migrated += 1;
			} else {
				result.skipped += 1;
			}
		} catch ( error ) {
			result.failed.push( {
				filePath,
				reason: error instanceof Error ? error.message : String( error ),
			} );
		}
	}

	return result;
}
