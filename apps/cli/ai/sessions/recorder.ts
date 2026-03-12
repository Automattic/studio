import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { getAiSessionsDirectoryForDate } from './paths';
import type { AiSessionEvent, AssistantMessageBlock, TurnStatus } from './types';

function toSortableTimestampPrefix( date: Date ): string {
	return date
		.toISOString()
		.replace( /:/g, '-' )
		.replace( /\.\d{3}Z$/, '' );
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
		const fileName = `${ toSortableTimestampPrefix( startedAt ) }-${ sessionId }.jsonl`;
		const filePath = path.join( directory, fileName );

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
