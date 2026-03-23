import fs from 'fs/promises';
import path from 'path';
import { getAiSessionsRootDirectory } from './paths';
import { readAiSessionSummaryFromEvents } from './summary';
import type { AiSessionEvent, AiSessionSummary, LoadedAiSession } from './types';

export async function readAiSessionEventsFromFile( filePath: string ): Promise< AiSessionEvent[] > {
	const content = await fs.readFile( filePath, 'utf8' );
	const lines = content
		.split( '\n' )
		.map( ( line ) => line.trim() )
		.filter( ( line ) => line.length > 0 );
	const events: AiSessionEvent[] = [];

	for ( const line of lines ) {
		try {
			events.push( JSON.parse( line ) as AiSessionEvent );
		} catch {
			// Ignore malformed lines and keep loading the rest.
		}
	}

	return events;
}

async function listSessionFilesRecursively( directory: string ): Promise< string[] > {
	try {
		const entries = await fs.readdir( directory, { withFileTypes: true, encoding: 'utf8' } );

		const nestedFiles = await Promise.all(
			entries.map( async ( entry ) => {
				const fullPath = path.join( directory, entry.name );

				if ( entry.isDirectory() ) {
					return listSessionFilesRecursively( fullPath );
				}

				if ( entry.isFile() && entry.name.endsWith( '.jsonl' ) ) {
					return [ fullPath ];
				}

				return [];
			} )
		);

		return nestedFiles.flat();
	} catch ( error ) {
		const fsError = error as NodeJS.ErrnoException;
		if ( fsError.code === 'ENOENT' ) {
			return [];
		}

		throw error;
	}
}

async function resolveSessionByIdOrPrefix(
	sessionIdOrPrefix: string
): Promise< AiSessionSummary > {
	const sessions = await listAiSessions();
	const exactMatch = sessions.find( ( session ) => session.id === sessionIdOrPrefix );
	const candidates = exactMatch
		? [ exactMatch ]
		: sessions.filter( ( session ) => session.id.startsWith( sessionIdOrPrefix ) );

	if ( candidates.length === 0 ) {
		throw new Error( `AI session not found: ${ sessionIdOrPrefix }` );
	}

	if ( candidates.length > 1 ) {
		const sample = candidates
			.slice( 0, 5 )
			.map( ( session ) => session.id )
			.join( ', ' );
		throw new Error(
			`Session id prefix is ambiguous: ${ sessionIdOrPrefix }. Matches: ${ sample }${
				candidates.length > 5 ? ', …' : ''
			}`
		);
	}

	return candidates[ 0 ];
}

async function pruneEmptySessionDirectories( startDirectory: string ): Promise< void > {
	const rootDirectory = getAiSessionsRootDirectory();
	let currentDirectory = startDirectory;

	while (
		currentDirectory.startsWith( rootDirectory + path.sep ) &&
		currentDirectory !== rootDirectory
	) {
		try {
			await fs.rmdir( currentDirectory );
		} catch ( error ) {
			const fsError = error as NodeJS.ErrnoException;
			if ( fsError.code === 'ENOTEMPTY' || fsError.code === 'ENOENT' ) {
				return;
			}

			throw error;
		}

		currentDirectory = path.dirname( currentDirectory );
	}
}

export async function listAiSessions(): Promise< AiSessionSummary[] > {
	const sessionFiles = await listSessionFilesRecursively( getAiSessionsRootDirectory() );
	const results = await Promise.allSettled(
		sessionFiles.map( async ( filePath ) => {
			const events = await readAiSessionEventsFromFile( filePath );
			return readAiSessionSummaryFromEvents( filePath, events );
		} )
	);

	const sessions = results
		.filter(
			( result ): result is PromiseFulfilledResult< AiSessionSummary | undefined > =>
				result.status === 'fulfilled'
		)
		.map( ( result ) => result.value )
		.filter( ( session ): session is AiSessionSummary => !! session );

	return sessions.sort( ( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt ) );
}

export async function loadAiSession( sessionIdOrPrefix: string ): Promise< LoadedAiSession > {
	const summary = await resolveSessionByIdOrPrefix( sessionIdOrPrefix );
	const events = await readAiSessionEventsFromFile( summary.filePath );
	return { summary, events };
}

export async function deleteAiSession( sessionIdOrPrefix: string ): Promise< AiSessionSummary > {
	const sessionToDelete = await resolveSessionByIdOrPrefix( sessionIdOrPrefix );
	await fs.rm( sessionToDelete.filePath, { force: false } );
	await pruneEmptySessionDirectories( path.dirname( sessionToDelete.filePath ) );

	return sessionToDelete;
}
