// Replay disk entries as if they were streaming, via `ui.handleEvent()`.

import {
	isStudioCustomEntryOfType,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import { filterEntriesAfterLastClear } from '@studio/common/ai/sessions/filter-events';
import { AiChatUI } from 'cli/ai/ui';
import type { AssistantMessage, ToolResultMessage } from '@mariozechner/pi-ai';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import type { AgentRuntimeEvent } from 'cli/ai/runtimes/runtime-events';

export function replaySessionHistory( ui: AiChatUI, entries: SessionEntry[] ): void {
	ui.prepareForReplay();

	const slice = filterEntriesAfterLastClear( entries ) as SessionEntry[];

	let isTurnOpen = false;
	let pendingResults: ToolResultMessage[] = [];
	const flushTurnResults = () => {
		if ( pendingResults.length === 0 ) return;
		const fakeAssistant: AssistantMessage = {
			role: 'assistant',
			content: [],
			api: 'anthropic-messages',
			provider: 'anthropic',
			model: '',
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: 'toolUse',
			timestamp: 0,
		};
		const event: AgentRuntimeEvent = {
			type: 'turn_end',
			message: fakeAssistant,
			toolResults: pendingResults,
		};
		ui.handleEvent( event );
		pendingResults = [];
	};

	try {
		for ( const entry of slice ) {
			ui.setReplayTimestamp( entry.timestamp );

			if ( isStudioCustomEntryOfType( entry, 'studio.site_selected' ) ) {
				const data = ( entry as StudioCustomEntry< 'studio.site_selected' > ).data;
				if ( data ) {
					ui.setActiveSite(
						{
							name: data.siteName,
							path: data.sitePath,
							running: false,
							remote: data.remote === true,
							url: data.url,
							wpcomSiteId: data.wpcomSiteId,
						},
						{ announce: true, emitEvent: false }
					);
				}
				continue;
			}

			if ( isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
				const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
				if ( ! data || data.source !== 'prompt' ) continue;
				if ( isTurnOpen ) {
					flushTurnResults();
					ui.endAgentTurn();
				}
				ui.beginAgentTurn();
				isTurnOpen = true;
				ui.addUserMessage( data.text );
				continue;
			}

			if ( isStudioCustomEntryOfType( entry, 'studio.tool_progress' ) ) {
				const data = ( entry as StudioCustomEntry< 'studio.tool_progress' > ).data;
				if ( data ) ui.setLoaderMessage( data.message );
				continue;
			}

			if ( isStudioCustomEntryOfType( entry, 'studio.agent_question' ) ) {
				const data = ( entry as StudioCustomEntry< 'studio.agent_question' > ).data;
				if ( data ) ui.showAgentQuestion( data.question, data.options );
				continue;
			}

			if ( isStudioCustomEntryOfType( entry, 'studio.turn_closed' ) ) {
				flushTurnResults();
				if ( isTurnOpen ) {
					ui.endAgentTurn();
					isTurnOpen = false;
				}
				continue;
			}

			if ( entry.type === 'message' ) {
				const message = entry.message;
				if ( message.role === 'assistant' ) {
					flushTurnResults();
					ui.handleEvent( { type: 'message_end', message } );
				} else if ( message.role === 'toolResult' ) {
					pendingResults.push( message );
				}
				continue;
			}
		}
		flushTurnResults();
	} finally {
		if ( isTurnOpen ) {
			ui.endAgentTurn();
		}
		ui.finishReplay();
	}
}
