// Re-run the on-disk transcript through the live UI so the resumed session
// looks like it was streaming again. Iterates pi `SessionEntry[]` directly
// and synthesizes the same `AgentRuntimeEvent`s the runtime would emit, so
// `ui.handleEvent()` is the single rendering path.

import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { AiChatUI } from 'cli/ai/ui';
import type { AssistantMessage, ToolResultMessage } from '@mariozechner/pi-ai';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import type { AgentRuntimeEvent } from 'cli/ai/runtimes/runtime-events';

function findLastClearIndex( entries: SessionEntry[] ): number {
	for ( let i = entries.length - 1; i >= 0; i -= 1 ) {
		if ( isStudioCustomEntryOfType( entries[ i ], 'studio.session_cleared' ) ) {
			return i;
		}
	}
	return -1;
}

export function replaySessionHistory( ui: AiChatUI, entries: SessionEntry[] ): void {
	ui.prepareForReplay();

	const clearAt = findLastClearIndex( entries );
	const slice = clearAt >= 0 ? entries.slice( clearAt + 1 ) : entries;

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
				const data = entry.data;
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
				const data = entry.data;
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
				if ( entry.data ) ui.setLoaderMessage( entry.data.message );
				continue;
			}

			if ( isStudioCustomEntryOfType( entry, 'studio.agent_question' ) ) {
				if ( entry.data ) ui.showAgentQuestion( entry.data.question, entry.data.options );
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
					ui.handleEvent( {
						type: 'message_end',
						message,
					} );
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
