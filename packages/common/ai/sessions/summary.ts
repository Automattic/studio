import fs from 'fs/promises';
import { isStudioCustomEntryOfType } from './entry-types';
import { readJsonlLines } from './jsonl';
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

// Summaries are cached for the life of the process, so `firstPrompt` — used
// only as a title/preview — must not pin an arbitrarily large pasted prompt
// in memory.
const FIRST_PROMPT_MAX_LENGTH = 500;

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

	return truncatePreview( text, ASSISTANT_REPLY_PREVIEW_MAX_LENGTH );
}

function createSummaryState(): AiSessionSummaryState {
	return { activeEnvironment: 'local', entryCount: 0 };
}

function truncatePreview( text: string, maxLength: number ): string {
	if ( text.length <= maxLength ) return text;
	return `${ text.slice( 0, maxLength ).trimEnd() }...`;
}

function addEntryToSummary(
	state: AiSessionSummaryState,
	entry: SessionEntry | PiSessionHeader
): void {
	// JSON lines can parse to null or primitives; those are malformed entries,
	// not events, and must not inflate the entry count.
	if ( ! entry || typeof entry !== 'object' ) return;

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
			state.firstPrompt = truncatePreview( data.text, FIRST_PROMPT_MAX_LENGTH );
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

	const sessionId = state.header?.id ?? '';
	// Stat only when the header is missing a timestamp — the common case
	// needs no filesystem round-trip here.
	const createdAt = state.header?.timestamp ?? ( await fs.stat( filePath ) ).mtime.toISOString();

	return {
		id: sessionId,
		filePath,
		createdAt,
		updatedAt: state.updatedAt ?? createdAt,
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

// Sentinel: the scan stopped at a legacy-format first line.
const LEGACY_FORMAT = Symbol( 'legacy-format' );

async function scanSummary(
	filePath: string
): Promise< AiSessionSummary | undefined | typeof LEGACY_FORMAT > {
	const state = createSummaryState();
	let isFirstLine = true;

	for await ( const line of readJsonlLines( filePath ) ) {
		if ( isFirstLine ) {
			isFirstLine = false;
			if ( detectSessionFormat( line ) === 'legacy' ) return LEGACY_FORMAT;
		}
		try {
			addEntryToSummary( state, JSON.parse( line ) as SessionEntry | PiSessionHeader );
		} catch {
			// malformed line
		}
	}

	return finishSummary( filePath, state );
}

export async function readAiSessionSummaryFromFile(
	filePath: string
): Promise< AiSessionSummary | undefined > {
	const summary = await scanSummary( filePath );
	if ( summary !== LEGACY_FORMAT ) return summary;

	// Rare case: the scan hit a legacy file. Migrate it in place, then rescan.
	// Detecting from the line the scan already read keeps pi files — the
	// common case — to a single open with no separate probe.
	await migrateLegacyFileInPlace( filePath );
	const rescanned = await scanSummary( filePath );
	return rescanned === LEGACY_FORMAT ? undefined : rescanned;
}
