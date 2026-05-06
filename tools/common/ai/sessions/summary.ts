import fs from 'fs/promises';
import { isStudioCustomEntryOfType, type SessionEntryBase } from './entry-types';
import type { AiSessionSummary } from './types';

interface PiSessionHeader {
	type: 'session';
	id: string;
	timestamp: string;
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

export async function readAiSessionSummaryFromEntries(
	filePath: string,
	fileEntries: Array< SessionEntryBase | PiSessionHeader >
): Promise< AiSessionSummary | undefined > {
	if ( fileEntries.length === 0 ) return undefined;

	const header = fileEntries.find( isPiHeader );
	const linkedAgentSessionIds: string[] = [];
	const createdAt = header?.timestamp;
	let updatedAt = header?.timestamp;
	const sessionId = header?.id ?? '';
	let firstPrompt: string | undefined;
	let ownerSitePath: string | undefined;
	let ownerSiteName: string | undefined;
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

		if ( isStudioCustomEntryOfType( entry, 'studio.session_linked' ) ) {
			const id = entry.data?.agentSessionId;
			if ( typeof id === 'string' && ! linkedAgentSessionIds.includes( id ) ) {
				linkedAgentSessionIds.push( id );
			}
			continue;
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.site_selected' ) ) {
			const data = entry.data;
			if ( ! data ) continue;
			selectedSiteName = data.siteName;
			const isLive = data.remote === true;
			activeEnvironment = isLive ? 'live' : 'local';
			lastSelectedWpcomSiteId = isLive ? data.wpcomSiteId : undefined;
			// Anchor the owner on the first *local* site; remote-only sessions
			// stay ownerless (sidebar Unassigned).
			if ( ownerSitePath === undefined && ! isLive ) {
				ownerSitePath = data.sitePath;
				ownerSiteName = data.siteName;
			}
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
		agentSessionId: linkedAgentSessionIds[ linkedAgentSessionIds.length - 1 ],
		linkedAgentSessionIds,
		firstPrompt,
		ownerSitePath,
		ownerSiteName,
		selectedSiteName,
		activeEnvironment,
		lastSelectedWpcomSiteId,
		endReason,
		eventCount: entryCount,
	};
}
