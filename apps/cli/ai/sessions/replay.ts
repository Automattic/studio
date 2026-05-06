import {
	filterEventsAfterLastClear,
	isVisibleUserMessage,
} from '@studio/common/ai/sessions/filter-events';
import { AiChatUI } from 'cli/ai/ui';
import type { AssistantMessage, ToolResultMessage } from '@mariozechner/pi-ai';
import type { AiSessionEvent } from '@studio/common/ai/sessions/types';
import type { AgentRuntimeEvent } from 'cli/ai/runtimes/runtime-events';

// Re-runs an on-disk session's events through the live UI so a resumed
// session looks like it was streaming again. We only synthesize the
// `AgentRuntimeEvent`s the UI's `handleEvent` switch actually acts on:
// `message_end` for assistant messages, `turn_end` for tool results,
// plus the studio-metadata transitions (site selection, agent question,
// loader text).

// Build a synthetic pi `AssistantMessage` from a recorded `sdk.message`
// event so the UI's `message_end` branch renders it the same way as a
// live turn. Only `text` and `tool_use` blocks are recreated; usage and
// timestamps are placeholders the UI doesn't read.
function legacyAssistantToPi(
	event: Extract< AiSessionEvent, { type: 'sdk.message' } > & {
		message: { type: 'assistant' };
	}
): AssistantMessage | null {
	const sdk = event.message as unknown as {
		error?: unknown;
		message?: {
			model?: string;
			content?: Array< {
				type: string;
				text?: string;
				id?: string;
				name?: string;
				input?: Record< string, unknown >;
			} >;
		};
	};
	const content = sdk.message?.content;
	if ( ! Array.isArray( content ) ) return null;
	const blocks: AssistantMessage[ 'content' ] = [];
	for ( const block of content ) {
		if ( block.type === 'text' && typeof block.text === 'string' ) {
			blocks.push( { type: 'text', text: block.text } );
		} else if (
			block.type === 'tool_use' &&
			typeof block.id === 'string' &&
			typeof block.name === 'string'
		) {
			blocks.push( {
				type: 'toolCall',
				id: block.id,
				name: block.name,
				arguments: block.input ?? {},
			} );
		}
	}
	return {
		role: 'assistant',
		content: blocks,
		api: 'anthropic-messages',
		provider: 'anthropic',
		model: sdk.message?.model ?? '',
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: sdk.error ? 'error' : 'stop',
		errorMessage: typeof sdk.error === 'string' ? sdk.error : undefined,
		timestamp: 0,
	};
}

function legacyToolResultToPi(
	event: Extract< AiSessionEvent, { type: 'sdk.message' } > & {
		message: { type: 'user' };
	}
): ToolResultMessage | null {
	const sdk = event.message as unknown as {
		message?: {
			content?: Array< {
				type: string;
				tool_use_id?: string;
				is_error?: boolean;
				content?: string | Array< { type: string; text?: string } >;
			} >;
		};
	};
	const block = sdk.message?.content?.find( ( b ) => b && b.type === 'tool_result' );
	if ( ! block || typeof block.tool_use_id !== 'string' ) return null;
	const text =
		typeof block.content === 'string'
			? [ { type: 'text' as const, text: block.content } ]
			: Array.isArray( block.content )
			? block.content
					.filter( ( b ) => b.type === 'text' && typeof b.text === 'string' )
					.map( ( b ) => ( { type: 'text' as const, text: b.text as string } ) )
			: [];
	return {
		role: 'toolResult',
		toolCallId: block.tool_use_id,
		toolName: 'unknown',
		content: text,
		isError: block.is_error === true,
		timestamp: 0,
	};
}

export function replaySessionHistory( ui: AiChatUI, events: AiSessionEvent[] ): void {
	ui.prepareForReplay();
	let isTurnOpen = false;
	let pendingResults: ToolResultMessage[] = [];
	const flushPendingResults = ( assistant: AssistantMessage | null ) => {
		if ( pendingResults.length === 0 ) return;
		const fakeAssistant: AssistantMessage = assistant ?? {
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
		const evt: AgentRuntimeEvent = {
			type: 'turn_end',
			message: fakeAssistant,
			toolResults: pendingResults,
		};
		ui.handleEvent( evt );
		pendingResults = [];
	};

	const eventsToReplay = filterEventsAfterLastClear( events );

	try {
		for ( const event of eventsToReplay ) {
			ui.setReplayTimestamp( event.timestamp );

			if ( event.type === 'site.selected' ) {
				ui.setActiveSite(
					{
						name: event.siteName,
						path: event.sitePath,
						running: false,
						remote: event.remote === true,
						url: typeof event.url === 'string' ? event.url : undefined,
						wpcomSiteId: typeof event.wpcomSiteId === 'number' ? event.wpcomSiteId : undefined,
					},
					{ announce: true, emitEvent: false }
				);
				continue;
			}

			if ( event.type === 'user.message' ) {
				if ( ! isVisibleUserMessage( event ) ) continue;
				if ( isTurnOpen ) {
					flushPendingResults( null );
					ui.endAgentTurn();
				}
				ui.beginAgentTurn();
				isTurnOpen = true;
				ui.addUserMessage( event.text );
				continue;
			}

			if ( event.type === 'sdk.message' ) {
				const inner = event.message as { type?: string };
				if ( inner?.type === 'assistant' ) {
					flushPendingResults( null );
					const message = legacyAssistantToPi(
						event as Extract< AiSessionEvent, { type: 'sdk.message' } > & {
							message: { type: 'assistant' };
						}
					);
					if ( message ) {
						ui.handleEvent( { type: 'message_end', message } );
					}
				} else if ( inner?.type === 'user' ) {
					const result = legacyToolResultToPi(
						event as Extract< AiSessionEvent, { type: 'sdk.message' } > & {
							message: { type: 'user' };
						}
					);
					if ( result ) pendingResults.push( result );
				}
				continue;
			}

			if ( event.type === 'tool.progress' ) {
				ui.setLoaderMessage( event.message );
				continue;
			}

			if ( event.type === 'agent.question' ) {
				ui.showAgentQuestion( event.question, event.options );
				continue;
			}

			if ( event.type === 'turn.closed' ) {
				flushPendingResults( null );
				if ( isTurnOpen ) {
					ui.endAgentTurn();
					isTurnOpen = false;
				}
			}
		}
		flushPendingResults( null );
	} finally {
		if ( isTurnOpen ) ui.endAgentTurn();
		ui.finishReplay();
	}
}
