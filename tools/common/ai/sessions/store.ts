import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { buildAiSessionFileName } from './file-naming';
import {
	detectSessionFormat,
	migrateLegacyEvents,
	migrateLegacyFileInPlace,
	type PiFileEntry,
} from './migration';
import { getAiSessionsDirectoryForDate } from './paths';
import { legacyEventToPiEntries, piEntriesToLegacyEvents } from './pi-translation';
import { readAiSessionSummaryFromEvents } from './summary';
import type { AiSessionEvent, AiSessionSummary, LoadedAiSession } from './types';

// Working directory recorded in pi session headers. The CLI uses
// `STUDIO_SITES_ROOT` for live runs; for sessions created via apps/studio's
// IPC layer (which has no sites root concept) we fall back to a generic
// label that pi just stores verbatim and never interprets.
const PI_SESSION_CWD = '~/Studio';

async function readJsonlEntries< T = Record< string, unknown > >(
	filePath: string
): Promise< T[] > {
	const content = await fs.readFile( filePath, 'utf8' );
	const out: T[] = [];
	for ( const line of content.split( '\n' ) ) {
		const trimmed = line.trim();
		if ( ! trimmed ) continue;
		try {
			out.push( JSON.parse( trimmed ) as T );
		} catch {
			// Skip malformed lines.
		}
	}
	return out;
}

// Reads the JSONL and returns it as a legacy `AiSessionEvent[]` view, the
// shape downstream summary / filter / renderer code expects. For pi-format
// files this triggers an in-place migration if the file is still in legacy
// format, then translates the resulting pi entries back to legacy events
// (the disk-truth is pi; legacy is just an in-memory abstraction).
export async function readAiSessionEventsFromFile( filePath: string ): Promise< AiSessionEvent[] > {
	await migrateLegacyFileInPlace( filePath, PI_SESSION_CWD );
	const fileEntries = await readJsonlEntries( filePath );
	return piEntriesToLegacyEvents( fileEntries );
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
	rootDirectory: string,
	sessionIdOrPrefix: string
): Promise< AiSessionSummary > {
	const sessions = await listAiSessions( rootDirectory );
	const exactMatch = sessions.find( ( session ) => session.id === sessionIdOrPrefix );
	const candidates = exactMatch
		? [ exactMatch ]
		: sessions.filter( ( session ) => session.id.startsWith( sessionIdOrPrefix ) );

	if ( candidates.length === 0 ) {
		throw new Error( `Code session not found: ${ sessionIdOrPrefix }` );
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

async function pruneEmptySessionDirectories(
	rootDirectory: string,
	startDirectory: string
): Promise< void > {
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

export async function listAiSessions( rootDirectory: string ): Promise< AiSessionSummary[] > {
	const sessionFiles = await listSessionFilesRecursively( rootDirectory );
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

export async function loadAiSession(
	rootDirectory: string,
	sessionIdOrPrefix: string
): Promise< LoadedAiSession > {
	const summary = await resolveSessionByIdOrPrefix( rootDirectory, sessionIdOrPrefix );
	const events = await readAiSessionEventsFromFile( summary.filePath );
	return { summary, events };
}

export async function createAiSession(
	rootDirectory: string,
	options: {
		site: {
			name: string;
			path: string;
			remote?: boolean;
			url?: string;
			wpcomSiteId?: number;
		};
	}
): Promise< AiSessionSummary > {
	// Build a pi-format session file directly (header + one custom entry for
	// the initial site selection) by routing the legacy events through the
	// migrator. Keeps the on-disk format consistent with sessions written by
	// the CLI runtime — there's exactly one shape on disk going forward.
	const startedAt = new Date();
	const sessionId = crypto.randomUUID();
	const directory = getAiSessionsDirectoryForDate( rootDirectory, startedAt );
	const fileName = buildAiSessionFileName( startedAt, sessionId );
	const filePath = path.join( directory, fileName );

	await fs.mkdir( directory, { recursive: true } );

	const seedEvents: AiSessionEvent[] = [
		{
			type: 'session.started',
			timestamp: startedAt.toISOString(),
			version: 1,
			sessionId,
		},
		{
			type: 'site.selected',
			timestamp: startedAt.toISOString(),
			siteName: options.site.name,
			sitePath: options.site.path,
			remote: options.site.remote,
			url: options.site.url,
			wpcomSiteId: options.site.wpcomSiteId,
		},
	];
	const fileEntries = migrateLegacyEvents( seedEvents, PI_SESSION_CWD );
	const serialized = fileEntries.map( ( entry ) => JSON.stringify( entry ) ).join( '\n' ) + '\n';
	await fs.writeFile( filePath, serialized, { encoding: 'utf8' } );

	const summary = await readAiSessionSummaryFromEvents( filePath, seedEvents );
	if ( ! summary ) {
		throw new Error( 'Failed to build summary for newly created session' );
	}
	return summary;
}

async function lastEntryId( filePath: string ): Promise< string | null > {
	const entries = await readJsonlEntries< { id?: unknown; type?: unknown } >( filePath );
	for ( let i = entries.length - 1; i >= 0; i -= 1 ) {
		const id = entries[ i ].id;
		if ( typeof id === 'string' && id.length > 0 ) return id;
	}
	return null;
}

async function appendPiEntries( filePath: string, entries: PiFileEntry[] ): Promise< void > {
	if ( entries.length === 0 ) return;
	const serialized = entries.map( ( entry ) => JSON.stringify( entry ) ).join( '\n' ) + '\n';
	await fs.appendFile( filePath, serialized, { encoding: 'utf8' } );
}

export async function appendAiSessionEvent(
	rootDirectory: string,
	sessionIdOrPrefix: string,
	event: AiSessionEvent
): Promise< void > {
	const summary = await resolveSessionByIdOrPrefix( rootDirectory, sessionIdOrPrefix );
	// `resolveSessionByIdOrPrefix` already migrated the file via
	// `listAiSessions` → `readAiSessionEventsFromFile`. Detect format defensively
	// so this stays correct if callers ever bypass the migration path.
	const content = await fs.readFile( summary.filePath, 'utf8' );
	const firstLine = content.split( '\n' ).find( ( line ) => line.trim().length > 0 );
	const format = detectSessionFormat( firstLine );

	if ( format === 'pi' ) {
		const parent = await lastEntryId( summary.filePath );
		const entries = legacyEventToPiEntries( event, parent );
		await appendPiEntries( summary.filePath, entries );
		return;
	}

	// Fallback for the (now unreachable) legacy-on-disk path. Kept so the
	// call doesn't silently no-op if a future regression skips migration.
	await fs.appendFile( summary.filePath, `${ JSON.stringify( event ) }\n`, {
		encoding: 'utf8',
	} );
}

export async function deleteAiSession(
	rootDirectory: string,
	sessionIdOrPrefix: string
): Promise< AiSessionSummary > {
	const sessionToDelete = await resolveSessionByIdOrPrefix( rootDirectory, sessionIdOrPrefix );
	await fs.rm( sessionToDelete.filePath, { force: false } );

	// Some legacy runtimes wrote sidecar files alongside the JSONL (e.g. the
	// pre-pi OpenAI runtime saved a `.openai-state.json` next to the JSONL).
	// Sweep any file in the same directory that shares the JSONL's stem so
	// deletes don't leave orphans behind. Best-effort: failures are ignored
	// — they just mean a stale sidecar remains, which is harmless.
	const sessionDir = path.dirname( sessionToDelete.filePath );
	const baseName = path.basename( sessionToDelete.filePath, '.jsonl' );
	try {
		const siblings = await fs.readdir( sessionDir );
		await Promise.all(
			siblings
				.filter( ( name ) => name.startsWith( `${ baseName }.` ) && name !== `${ baseName }.jsonl` )
				.map( ( name ) =>
					fs.rm( path.join( sessionDir, name ), { force: true } ).catch( () => undefined )
				)
		);
	} catch {
		// Directory disappeared between rm and readdir, or readdir failed —
		// either way the JSONL is gone, which is what we promised.
	}

	await pruneEmptySessionDirectories( rootDirectory, sessionDir );

	return sessionToDelete;
}
