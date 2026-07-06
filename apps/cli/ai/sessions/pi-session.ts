import fs from 'fs/promises';
import path from 'path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { migrateLegacyFileInPlace } from '@studio/common/ai/sessions/migration';
import { getAiSessionsDirectoryForDate } from '@studio/common/ai/sessions/paths';
import { getAiSessionsRootDirectory } from 'cli/ai/sessions/paths';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';

export interface CreateStudioSessionOptions {
	startedAt?: Date;
}

export async function createStudioSession(
	options: CreateStudioSessionOptions = {}
): Promise< SessionManager > {
	const startedAt = options.startedAt ?? new Date();
	const sessionDir = getAiSessionsDirectoryForDate( getAiSessionsRootDirectory(), startedAt );
	await fs.mkdir( sessionDir, { recursive: true } );
	return SessionManager.create( STUDIO_SITES_ROOT, sessionDir );
}

export async function openStudioSession( filePath: string ): Promise< SessionManager > {
	await migrateLegacyFileInPlace( filePath, STUDIO_SITES_ROOT );
	const sessionDir = path.dirname( filePath );
	return SessionManager.open( filePath, sessionDir, STUDIO_SITES_ROOT );
}

export async function listStudioSessionFiles( rootDirectory: string ): Promise< string[] > {
	async function walk( directory: string ): Promise< string[] > {
		let entries;
		try {
			entries = await fs.readdir( directory, { withFileTypes: true, encoding: 'utf8' } );
		} catch ( error ) {
			const fsError = error as NodeJS.ErrnoException;
			if ( fsError.code === 'ENOENT' ) return [];
			throw error;
		}
		const nested = await Promise.all(
			entries.map( async ( entry ) => {
				const fullPath = path.join( directory, entry.name );
				if ( entry.isDirectory() ) return walk( fullPath );
				if ( entry.isFile() && entry.name.endsWith( '.jsonl' ) ) return [ fullPath ];
				return [];
			} )
		);
		return nested.flat();
	}
	return walk( rootDirectory );
}
