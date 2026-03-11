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

	private constructor( sessionId: string, filePath: string ) {
		this.sessionId = sessionId;
		this.filePath = filePath;
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
