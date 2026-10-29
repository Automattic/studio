import fs from 'fs/promises';
import path from 'path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';
import { migrateLegacyFileInPlace } from '@studio/agent/node/sessions/migration';
import { getAiSessionsDirectoryForDate } from '@studio/agent/node/sessions/paths';

export interface CreateStudioSessionOptions {
	startedAt?: Date;
}

// Sessions run in `sitesRoot`, the folder the agent's file tools are rooted in.
export async function createStudioSession(
	sitesRoot: string,
	options: CreateStudioSessionOptions = {}
): Promise< SessionManager > {
	const startedAt = options.startedAt ?? new Date();
	const sessionDir = getAiSessionsDirectoryForDate( getSessionsDirectory(), startedAt );
	await fs.mkdir( sessionDir, { recursive: true } );
	return SessionManager.create( sitesRoot, sessionDir );
}

export async function openStudioSession(
	sitesRoot: string,
	filePath: string
): Promise< SessionManager > {
	await migrateLegacyFileInPlace( filePath, sitesRoot );
	const sessionDir = path.dirname( filePath );
	return SessionManager.open( filePath, sessionDir, sitesRoot );
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
