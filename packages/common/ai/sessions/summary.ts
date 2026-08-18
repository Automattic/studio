import { createReadStream } from 'fs';
import fs from 'fs/promises';
import readline from 'readline';
import { isStudioCustomEntryOfType } from './entry-types';
import { migrateLegacyFileInPlace } from './migration';
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

interface AiSessionSummaryState {
	header?: PiSessionHeader;
	updatedAt?: string;
	firstPrompt?: string;
	assistantReplyPreview?: string;
	selectedSiteName?: string;
	activeEnvironment: 'local' | 'live';
	lastSelectedWpcomSiteId?: number;
	endReason?: 'error' | 'stopped';
	entryCount: number;
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

function createSummaryState(): AiSessionSummaryState {
	return { activeEnvironment: 'local', entryCount: 0 };
}

function addEntryToSummary(
	state: AiSessionSummaryState,
	entry: SessionEntry | PiSessionHeader
): void {
	if ( isPiHeader( entry ) ) {
		state.header ??= entry;
		state.updatedAt ??= entry.timestamp;
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

async function finishSummary(
	filePath: string,
	state: AiSessionSummaryState
): Promise< AiSessionSummary | undefined > {
	if ( ! state.header && state.entryCount === 0 ) return undefined;

	const createdAt = state.header?.timestamp;
	const sessionId = state.header?.id ?? '';
	const stats = await fs.stat( filePath );
	const fallbackTimestamp = stats.mtime.toISOString();

	return {
		id: sessionId,
		filePath,
		createdAt: createdAt ?? fallbackTimestamp,
		updatedAt: state.updatedAt ?? createdAt ?? fallbackTimestamp,
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
	const state = createSummaryState();
	for ( const entry of fileEntries ) {
		addEntryToSummary( state, entry );
	}
	return finishSummary( filePath, state );
}

export async function readAiSessionSummaryFromFile(
	filePath: string
): Promise< AiSessionSummary | undefined > {
	await migrateLegacyFileInPlace( filePath, '~/Studio' );

	const state = createSummaryState();
	const lines = readline.createInterface( {
		input: createReadStream( filePath, { encoding: 'utf8' } ),
		crlfDelay: Infinity,
	} );

	for await ( const line of lines ) {
		const trimmed = line.trim();
		if ( ! trimmed ) continue;
		try {
			addEntryToSummary( state, JSON.parse( trimmed ) as SessionEntry | PiSessionHeader );
		} catch {
			// malformed line
		}
	}

	return finishSummary( filePath, state );
}
