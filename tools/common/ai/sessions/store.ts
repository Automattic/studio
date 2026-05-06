import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { buildAiSessionFileName } from './file-naming';
import { migrateLegacyFileInPlace } from './migration';
import { getAiSessionsDirectoryForDate } from './paths';
import { readAiSessionSummaryFromEntries } from './summary';
import type {
	SessionEntryBase,
	StudioCustomEntryDataMap,
	StudioCustomEntryType,
} from './entry-types';
import type { AiSessionSummary, LoadedAiSession } from './types';

// Reads the JSONL as a sequence of pi `FileEntry` objects (header + entries).
// Migrates the file in place if it's still in the Studio-legacy event shape;
// the eager `migrateAllSessions` walker normally handles that at app launch
// but the lazy fallback keeps file-by-file reads safe.
export async function readPiFileEntries( filePath: string ): Promise< SessionEntryBase[] > {
	let content: string;
	try {
		content = await fs.readFile( filePath, 'utf8' );
	} catch ( error ) {
		if ( ( error as NodeJS.ErrnoException ).code === 'ENOENT' ) return [];
		throw error;
	}
	if ( ! content.trim() ) return [];

	// `migrateLegacyFileInPlace` peeks at the first line and bails out for
	// pi-format files, so the cost on the hot path is just a small re-read.
	await migrateLegacyFileInPlace( filePath, '~/Studio' );
	const refreshed = await fs.readFile( filePath, 'utf8' );

	const entries: SessionEntryBase[] = [];
	for ( const line of refreshed.split( '\n' ) ) {
		const trimmed = line.trim();
		if ( ! trimmed ) continue;
		try {
			entries.push( JSON.parse( trimmed ) as SessionEntryBase );
		} catch {
			// Ignore malformed lines and keep loading the rest.
		}
	}
	return entries;
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
			const entries = await readPiFileEntries( filePath );
			return readAiSessionSummaryFromEntries( filePath, entries );
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
	const entries = await readPiFileEntries( summary.filePath );
	return { summary, entries };
}

export interface CreateAiSessionOptions {
	site?: {
		name: string;
		path: string;
		remote?: boolean;
		url?: string;
		wpcomSiteId?: number;
	};
}

const PI_SESSION_VERSION = 3;
const PI_SESSION_CWD = '~/Studio';

function shortId(): string {
	return crypto.randomUUID().slice( 0, 8 );
}

export async function createAiSession(
	rootDirectory: string,
	options: CreateAiSessionOptions = {}
): Promise< AiSessionSummary > {
	const startedAt = new Date();
	const sessionId = crypto.randomUUID();
	const directory = getAiSessionsDirectoryForDate( rootDirectory, startedAt );
	const fileName = buildAiSessionFileName( startedAt, sessionId );
	const filePath = path.join( directory, fileName );

	await fs.mkdir( directory, { recursive: true } );

	const isoTs = startedAt.toISOString();
	const lines: string[] = [
		JSON.stringify( {
			type: 'session',
			version: PI_SESSION_VERSION,
			id: sessionId,
			timestamp: isoTs,
			cwd: PI_SESSION_CWD,
		} ),
	];
	const entries: SessionEntryBase[] = [];
	if ( options.site ) {
		const entry = {
			type: 'custom' as const,
			id: shortId(),
			parentId: null,
			timestamp: isoTs,
			customType: 'studio.site_selected',
			data: {
				siteName: options.site.name,
				sitePath: options.site.path,
				remote: options.site.remote,
				url: options.site.url,
				wpcomSiteId: options.site.wpcomSiteId,
			},
		};
		entries.push( entry as SessionEntryBase );
		lines.push( JSON.stringify( entry ) );
	}

	await fs.writeFile( filePath, lines.join( '\n' ) + '\n', { encoding: 'utf8' } );

	const allEntries = [
		{
			type: 'session' as const,
			id: sessionId,
			timestamp: isoTs,
		},
		...entries,
	];
	const summary = await readAiSessionSummaryFromEntries(
		filePath,
		allEntries as Array< SessionEntryBase | { type: 'session'; id: string; timestamp: string } >
	);
	if ( ! summary ) {
		throw new Error( 'Failed to build summary for newly created session' );
	}
	return summary;
}

async function readLastEntryId( filePath: string ): Promise< string | null > {
	const entries = await readPiFileEntries( filePath );
	for ( let i = entries.length - 1; i >= 0; i -= 1 ) {
		const id = ( entries[ i ] as { id?: unknown } ).id;
		if ( typeof id === 'string' && id.length > 0 ) return id;
	}
	return null;
}

// Append a Studio `studio.*` `CustomEntry` to a session JSONL. Used by the
// desktop IPC layer for `setSessionEnvironment`, `setAiSessionModel`, etc.
// Note that `setAiSessionModel` writes a `model_change` entry instead — pi
// has its own discriminator for that — exposed via `appendModelChangeEntry`
// below.
export async function appendStudioEntry< T extends StudioCustomEntryType >(
	rootDirectory: string,
	sessionIdOrPrefix: string,
	customType: T,
	data: StudioCustomEntryDataMap[ T ]
): Promise< void > {
	const summary = await resolveSessionByIdOrPrefix( rootDirectory, sessionIdOrPrefix );
	const parentId = await readLastEntryId( summary.filePath );
	const entry = {
		type: 'custom',
		id: shortId(),
		parentId,
		timestamp: new Date().toISOString(),
		customType,
		data,
	};
	await fs.appendFile( summary.filePath, JSON.stringify( entry ) + '\n', { encoding: 'utf8' } );
}

// Append a pi `model_change` entry — this is how the UI's composer-driven
// `/model` switch gets persisted so the next turn's resume context picks
// up the user's choice.
export async function appendModelChangeEntry(
	rootDirectory: string,
	sessionIdOrPrefix: string,
	provider: string,
	modelId: string
): Promise< void > {
	const summary = await resolveSessionByIdOrPrefix( rootDirectory, sessionIdOrPrefix );
	const parentId = await readLastEntryId( summary.filePath );
	const entry = {
		type: 'model_change',
		id: shortId(),
		parentId,
		timestamp: new Date().toISOString(),
		provider,
		modelId,
	};
	await fs.appendFile( summary.filePath, JSON.stringify( entry ) + '\n', { encoding: 'utf8' } );
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
	// deletes don't leave orphans behind. Best-effort: failures are ignored —
	// they just mean a stale sidecar remains, which is harmless.
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
