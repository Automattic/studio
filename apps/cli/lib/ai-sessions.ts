import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { getAppdataDirectory } from 'cli/lib/appdata';

export type TurnStatus = 'success' | 'error' | 'max_turns' | 'interrupted';

export type AssistantMessageBlock =
	| {
			type: 'text';
			text: string;
	  }
	| {
			type: 'tool_use';
			name: string;
			detail?: string;
	  };

export type AiSessionEvent =
	| {
			type: 'session.started';
			timestamp: string;
			version: 1;
			sessionId: string;
	  }
	| {
			type: 'session.linked';
			timestamp: string;
			agentSessionId: string;
	  }
	| {
			type: 'site.selected';
			timestamp: string;
			siteName: string;
			sitePath: string;
	  }
	| {
			type: 'user.message';
			timestamp: string;
			text: string;
			source: 'prompt' | 'ask_user';
			sitePath?: string;
	  }
	| {
			type: 'assistant.message';
			timestamp: string;
			blocks: AssistantMessageBlock[];
	  }
	| {
			type: 'tool.result';
			timestamp: string;
			ok: boolean;
			text: string;
	  }
	| {
			type: 'tool.progress';
			timestamp: string;
			message: string;
	  }
	| {
			type: 'agent.question';
			timestamp: string;
			question: string;
			options: Array< {
				label: string;
				description: string;
			} >;
	  }
	| {
			type: 'turn.closed';
			timestamp: string;
			status: TurnStatus;
	  };

export interface AiSessionSummary {
	id: string;
	filePath: string;
	createdAt: string;
	updatedAt: string;
	agentSessionId?: string;
	linkedAgentSessionIds: string[];
	firstPrompt?: string;
	selectedSiteName?: string;
	endReason?: 'error' | 'stopped';
	eventCount: number;
}

export interface LoadedAiSession {
	summary: AiSessionSummary;
	events: AiSessionEvent[];
}

export function getAiSessionsRootDirectory(): string {
	return path.join( getAppdataDirectory(), 'sessions' );
}

function formatDatePart( value: number ): string {
	return String( value ).padStart( 2, '0' );
}

export function getAiSessionsDirectoryForDate( date: Date ): string {
	const year = String( date.getFullYear() );
	const month = formatDatePart( date.getMonth() + 1 );
	const day = formatDatePart( date.getDate() );
	return path.join( getAiSessionsRootDirectory(), year, month, day );
}

function toIsoTimestamp( value?: Date ): string {
	return ( value ?? new Date() ).toISOString();
}

export class AiSessionRecorder {
	public readonly sessionId: string;
	public readonly filePath: string;

	private linkedAgentSessionIds = new Set< string >();

	private constructor( sessionId: string, filePath: string, linkedAgentSessionIds: string[] = [] ) {
		this.sessionId = sessionId;
		this.filePath = filePath;
		this.linkedAgentSessionIds = new Set( linkedAgentSessionIds );
	}

	static async create( options: { startedAt?: Date } = {} ): Promise< AiSessionRecorder > {
		const startedAt = options.startedAt ?? new Date();
		const sessionId = crypto.randomUUID();
		const directory = getAiSessionsDirectoryForDate( startedAt );
		const filePath = path.join( directory, `${ sessionId }.jsonl` );

		await fs.mkdir( directory, { recursive: true } );

		const recorder = new AiSessionRecorder( sessionId, filePath );
		await recorder.appendEvent( {
			type: 'session.started',
			timestamp: toIsoTimestamp( startedAt ),
			version: 1,
			sessionId,
		} );

		return recorder;
	}

	static async open( options: {
		sessionId: string;
		filePath: string;
		linkedAgentSessionIds?: string[];
	} ): Promise< AiSessionRecorder > {
		await fs.access( options.filePath );
		return new AiSessionRecorder(
			options.sessionId,
			options.filePath,
			options.linkedAgentSessionIds ?? []
		);
	}

	async recordAgentSessionId( agentSessionId: string ): Promise< void > {
		if ( this.linkedAgentSessionIds.has( agentSessionId ) ) {
			return;
		}

		this.linkedAgentSessionIds.add( agentSessionId );
		await this.appendEvent( {
			type: 'session.linked',
			timestamp: toIsoTimestamp(),
			agentSessionId,
		} );
	}

	async recordSiteSelected( site: { name: string; path: string } ): Promise< void > {
		await this.appendEvent( {
			type: 'site.selected',
			timestamp: toIsoTimestamp(),
			siteName: site.name,
			sitePath: site.path,
		} );
	}

	async recordUserMessage( options: {
		text: string;
		source: 'prompt' | 'ask_user';
		sitePath?: string;
	} ): Promise< void > {
		await this.appendEvent( {
			type: 'user.message',
			timestamp: toIsoTimestamp(),
			text: options.text,
			source: options.source,
			sitePath: options.sitePath,
		} );
	}

	async recordAssistantMessage( blocks: AssistantMessageBlock[] ): Promise< void > {
		if ( blocks.length === 0 ) {
			return;
		}

		await this.appendEvent( {
			type: 'assistant.message',
			timestamp: toIsoTimestamp(),
			blocks,
		} );
	}

	async recordToolResult( options: { ok: boolean; text: string } ): Promise< void > {
		await this.appendEvent( {
			type: 'tool.result',
			timestamp: toIsoTimestamp(),
			ok: options.ok,
			text: options.text,
		} );
	}

	async recordToolProgress( message: string ): Promise< void > {
		if ( ! message.trim() ) {
			return;
		}

		await this.appendEvent( {
			type: 'tool.progress',
			timestamp: toIsoTimestamp(),
			message,
		} );
	}

	async recordAgentQuestion( options: {
		question: string;
		options: Array< {
			label: string;
			description: string;
		} >;
	} ): Promise< void > {
		await this.appendEvent( {
			type: 'agent.question',
			timestamp: toIsoTimestamp(),
			question: options.question,
			options: options.options,
		} );
	}

	async recordTurnClosed( status: TurnStatus ): Promise< void > {
		await this.appendEvent( {
			type: 'turn.closed',
			timestamp: toIsoTimestamp(),
			status,
		} );
	}

	private async appendEvent( event: AiSessionEvent ): Promise< void > {
		await fs.appendFile( this.filePath, `${ JSON.stringify( event ) }\n`, {
			encoding: 'utf8',
		} );
	}
}

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

function getSessionIdFromPath( filePath: string ): string {
	return path.basename( filePath, '.jsonl' );
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

async function readAiSessionSummaryFromFile(
	filePath: string
): Promise< AiSessionSummary | undefined > {
	const events = await readAiSessionEventsFromFile( filePath );
	if ( events.length === 0 ) {
		return undefined;
	}

	const linkedAgentSessionIds: string[] = [];
	let createdAt: string | undefined;
	let updatedAt: string | undefined;
	let sessionId = getSessionIdFromPath( filePath );
	let firstPrompt: string | undefined;
	let selectedSiteName: string | undefined;
	let endReason: 'error' | 'stopped' | undefined;
	let eventCount = 0;

	for ( const event of events ) {
		eventCount += 1;
		updatedAt = event.timestamp;

		if ( event.type === 'session.started' ) {
			createdAt = event.timestamp;
			if ( event.sessionId.trim().length > 0 ) {
				sessionId = event.sessionId;
			}
		}

		if (
			event.type === 'session.linked' &&
			! linkedAgentSessionIds.includes( event.agentSessionId )
		) {
			linkedAgentSessionIds.push( event.agentSessionId );
		}

		if ( event.type === 'site.selected' ) {
			selectedSiteName = event.siteName;
		}

		if ( event.type === 'user.message' && event.source === 'prompt' && ! firstPrompt ) {
			firstPrompt = event.text;
		}

		if ( event.type === 'turn.closed' ) {
			if ( event.status === 'error' ) {
				endReason = 'error';
			} else if ( event.status === 'interrupted' ) {
				endReason = 'stopped';
			}
		}
	}

	const stats = await fs.stat( filePath );
	const fallbackTimestamp = stats.mtime.toISOString();

	return {
		id: sessionId,
		filePath,
		createdAt: createdAt ?? fallbackTimestamp,
		updatedAt: updatedAt ?? createdAt ?? fallbackTimestamp,
		agentSessionId: linkedAgentSessionIds[ linkedAgentSessionIds.length - 1 ],
		linkedAgentSessionIds,
		firstPrompt,
		selectedSiteName,
		endReason,
		eventCount,
	};
}

export async function listAiSessions(): Promise< AiSessionSummary[] > {
	const sessionFiles = await listSessionFilesRecursively( getAiSessionsRootDirectory() );
	const results = await Promise.allSettled(
		sessionFiles.map( ( filePath ) => readAiSessionSummaryFromFile( filePath ) )
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

	const summary = candidates[ 0 ];
	const events = await readAiSessionEventsFromFile( summary.filePath );
	return { summary, events };
}
