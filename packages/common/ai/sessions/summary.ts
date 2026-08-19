import fs from 'fs';
import fsPromises from 'fs/promises';
import readline from 'readline';
import { isStudioCustomEntryOfType } from './entry-types';
import { detectSessionFormat, migrateLegacyFileInPlace } from './migration';
import type { AiSessionSummary } from './types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

interface PiSessionHeader {
	type: 'session';
	id: string;
	timestamp: string;
}

interface PiAssistantContentBlock {
	type: string;
	text?: unknown;
}

interface PiAssistantMessageLike {
	role?: unknown;
	content?: unknown;
}

const ASSISTANT_REPLY_PREVIEW_MAX_LENGTH = 180;

interface SessionSummaryState {
	createdAt?: string;
	updatedAt?: string;
	sessionId: string;
	firstPrompt?: string;
	assistantReplyPreview?: string;
	selectedSiteName?: string;
	activeEnvironment: 'local' | 'live';
	lastSelectedWpcomSiteId?: number;
	endReason?: 'error' | 'stopped';
	entryCount: number;
	hasEntries: boolean;
}

function isPiHeader( value: unknown ): value is PiSessionHeader {
	return (
		!! value &&
		typeof value === 'object' &&
		( value as { type?: unknown } ).type === 'session' &&
		typeof ( value as { id?: unknown } ).id === 'string' &&
		typeof ( value as { timestamp?: unknown } ).timestamp === 'string'
	);
}

function getAssistantReplyPreview( entry: SessionEntry ): string | undefined {
	if ( entry.type !== 'message' ) {
		return undefined;
	}

	const message = ( entry as { message?: unknown } ).message as PiAssistantMessageLike | undefined;
	if ( ! message || message.role !== 'assistant' || ! Array.isArray( message.content ) ) {
		return undefined;
	}

	const text = message.content
		.filter(
			( block ): block is PiAssistantContentBlock =>
				!! block &&
				typeof block === 'object' &&
				( block as PiAssistantContentBlock ).type === 'text' &&
				typeof ( block as PiAssistantContentBlock ).text === 'string'
		)
		.map( ( block ) => block.text as string )
		.join( ' ' )
		.replace( /\s+/g, ' ' )
		.trim();

	if ( ! text ) {
		return undefined;
	}

	if ( text.length <= ASSISTANT_REPLY_PREVIEW_MAX_LENGTH ) {
		return text;
	}

	return `${ text.slice( 0, ASSISTANT_REPLY_PREVIEW_MAX_LENGTH ).trimEnd() }...`;
}

function createSessionSummaryState(): SessionSummaryState {
	return {
		sessionId: '',
		activeEnvironment: 'local',
		entryCount: 0,
		hasEntries: false,
	};
}

function addEntryToSessionSummary(
	state: SessionSummaryState,
	entry: SessionEntry | PiSessionHeader
): void {
	state.hasEntries = true;
	if ( isPiHeader( entry ) ) {
		state.createdAt = entry.timestamp;
		state.updatedAt = entry.timestamp;
		state.sessionId = entry.id;
		return;
	}

	state.entryCount += 1;
	const ts = entry.timestamp;
	if ( typeof ts === 'string' ) state.updatedAt = ts;

	const replyPreview = getAssistantReplyPreview( entry );
	if ( replyPreview ) {
		state.assistantReplyPreview = replyPreview;
	}

	if ( isStudioCustomEntryOfType( entry, 'studio.site_selected' ) ) {
		const data = entry.data;
		if ( ! data ) return;
		state.selectedSiteName = data.siteName;
		const isLive = data.remote === true;
		state.activeEnvironment = isLive ? 'live' : 'local';
		state.lastSelectedWpcomSiteId = isLive ? data.wpcomSiteId : undefined;
		return;
	}

	if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
		const data = entry.data;
		if ( data && data.source === 'prompt' && ! state.firstPrompt ) {
			state.firstPrompt = data.text;
		}
		return;
	}

	if ( isStudioCustomEntryOfType( entry, 'studio.turn_closed' ) ) {
		const status = entry.data?.status;
		if ( status === 'error' ) state.endReason = 'error';
		else if ( status === 'interrupted' ) state.endReason = 'stopped';
	}
}

async function finishSessionSummary(
	filePath: string,
	state: SessionSummaryState
): Promise< AiSessionSummary | undefined > {
	if ( ! state.hasEntries ) return undefined;

	const stats = await fsPromises.stat( filePath );
	const fallbackTimestamp = stats.mtime.toISOString();

	return {
		id: state.sessionId,
		filePath,
		createdAt: state.createdAt ?? fallbackTimestamp,
		updatedAt: state.updatedAt ?? state.createdAt ?? fallbackTimestamp,
		firstPrompt: state.firstPrompt,
		assistantReplyPreview: state.assistantReplyPreview,
		ownerSiteId: undefined,
		ownerSitePath: undefined,
		ownerSiteName: undefined,
		selectedSiteName: state.selectedSiteName,
		activeEnvironment: state.activeEnvironment,
		lastSelectedWpcomSiteId: state.lastSelectedWpcomSiteId,
		endReason: state.endReason,
		eventCount: state.entryCount,
	};
}

export async function readAiSessionSummaryFromEntries(
	filePath: string,
	fileEntries: Array< SessionEntry | PiSessionHeader >
): Promise< AiSessionSummary | undefined > {
	const state = createSessionSummaryState();
	for ( const entry of fileEntries ) {
		addEntryToSessionSummary( state, entry );
	}
	return finishSessionSummary( filePath, state );
}

export async function readAiSessionSummaryFromFile(
	filePath: string
): Promise< AiSessionSummary | undefined > {
	let firstLine: string | undefined;
	const firstLineStream = fs.createReadStream( filePath, { encoding: 'utf8' } );
	const firstLineReader = readline.createInterface( {
		input: firstLineStream,
		crlfDelay: Infinity,
	} );
	for await ( const line of firstLineReader ) {
		if ( line.trim() ) {
			firstLine = line;
			break;
		}
	}
	firstLineReader.close();
	firstLineStream.destroy();

	if ( detectSessionFormat( firstLine ) === 'legacy' ) {
		await migrateLegacyFileInPlace( filePath, '~/Studio' );
	}

	const state = createSessionSummaryState();
	const reader = readline.createInterface( {
		input: fs.createReadStream( filePath, { encoding: 'utf8' } ),
		crlfDelay: Infinity,
	} );
	for await ( const line of reader ) {
		const trimmed = line.trim();
		if ( ! trimmed ) continue;
		try {
			addEntryToSessionSummary( state, JSON.parse( trimmed ) as SessionEntry | PiSessionHeader );
		} catch {
			// malformed line
		}
	}

	return finishSessionSummary( filePath, state );
}
