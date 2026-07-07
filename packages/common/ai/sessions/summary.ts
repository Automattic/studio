import fs from 'fs/promises';
import { isStudioCustomEntryOfType } from './entry-types';
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

export async function readAiSessionSummaryFromEntries(
	filePath: string,
	fileEntries: Array< SessionEntry | PiSessionHeader >
): Promise< AiSessionSummary | undefined > {
	if ( fileEntries.length === 0 ) return undefined;

	const header = fileEntries.find( isPiHeader );
	const createdAt = header?.timestamp;
	let updatedAt = header?.timestamp;
	const sessionId = header?.id ?? '';
	let firstPrompt: string | undefined;
	let assistantReplyPreview: string | undefined;
	let selectedSiteName: string | undefined;
	let activeEnvironment: 'local' | 'live' = 'local';
	let lastSelectedWpcomSiteId: number | undefined;
	let endReason: 'error' | 'stopped' | undefined;
	let entryCount = 0;

	for ( const entry of fileEntries ) {
		if ( isPiHeader( entry ) ) continue;
		entryCount += 1;
		const ts = entry.timestamp;
		if ( typeof ts === 'string' ) updatedAt = ts;

		const replyPreview = getAssistantReplyPreview( entry );
		if ( replyPreview ) {
			assistantReplyPreview = replyPreview;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.site_selected' ) ) {
			const data = entry.data;
			if ( ! data ) continue;
			selectedSiteName = data.siteName;
			const isLive = data.remote === true;
			activeEnvironment = isLive ? 'live' : 'local';
			lastSelectedWpcomSiteId = isLive ? data.wpcomSiteId : undefined;
			continue;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			const data = entry.data;
			if ( data && data.source === 'prompt' && ! firstPrompt ) {
				firstPrompt = data.text;
			}
			continue;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.turn_closed' ) ) {
			const status = entry.data?.status;
			if ( status === 'error' ) endReason = 'error';
			else if ( status === 'interrupted' ) endReason = 'stopped';
			continue;
		}
	}

	const stats = await fs.stat( filePath );
	const fallbackTimestamp = stats.mtime.toISOString();

	return {
		id: sessionId,
		filePath,
		createdAt: createdAt ?? fallbackTimestamp,
		updatedAt: updatedAt ?? createdAt ?? fallbackTimestamp,
		firstPrompt,
		assistantReplyPreview,
		ownerSitePath: undefined,
		ownerSiteName: undefined,
		selectedSiteName,
		activeEnvironment,
		lastSelectedWpcomSiteId,
		endReason,
		eventCount: entryCount,
	};
}
