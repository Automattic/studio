import fs from 'fs/promises';
import { extractAiSessionIdFromFilePath } from './file-naming';
import type { AiSessionEvent, AiSessionSummary } from './types';

export async function readAiSessionSummaryFromEvents(
	filePath: string,
	events: AiSessionEvent[]
): Promise< AiSessionSummary | undefined > {
	if ( events.length === 0 ) {
		return undefined;
	}

	const linkedAgentSessionIds: string[] = [];
	let createdAt: string | undefined;
	let updatedAt: string | undefined;
	let sessionId = extractAiSessionIdFromFilePath( filePath );
	let firstPrompt: string | undefined;
	let ownerSitePath: string | undefined;
	let ownerSiteName: string | undefined;
	let selectedSiteName: string | undefined;
	let activeEnvironment: 'local' | 'live' = 'local';
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
			if ( ownerSitePath === undefined ) {
				ownerSitePath = event.sitePath;
				ownerSiteName = event.siteName;
			}
			activeEnvironment = event.remote === true ? 'live' : 'local';
		}

		if ( event.type === 'environment.selected' ) {
			activeEnvironment = event.environment;
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
		ownerSitePath,
		ownerSiteName,
		selectedSiteName,
		activeEnvironment,
		endReason,
		eventCount,
	};
}
