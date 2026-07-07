import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export function findLastAssistant(
	messages: ReadonlyArray< AgentMessage >
): AssistantMessage | undefined {
	for ( let i = messages.length - 1; i >= 0; i -= 1 ) {
		const message = messages[ i ];
		if ( ( message as AssistantMessage ).role === 'assistant' ) {
			return message as AssistantMessage;
		}
	}
	return undefined;
}

export interface AgentEndTurnResult {
	success: boolean;
	interrupted: boolean;
}

export function getAgentEndTurnResult(
	event: Extract< AgentSessionEvent, { type: 'agent_end' } >
): AgentEndTurnResult {
	const lastAssistant = findLastAssistant( event.messages );
	const interrupted = lastAssistant?.stopReason === 'aborted';
	return {
		success:
			! lastAssistant ||
			( lastAssistant.stopReason !== 'error' && lastAssistant.stopReason !== 'aborted' ),
		interrupted,
	};
}

/**
 * Best-effort human-readable reason for a terminal (errored/aborted) agent turn,
 * derived from the last assistant message: its `errorMessage` when present, else
 * its text content. Returns `null` when neither is available; callers supply a
 * localized fallback.
 */
export function getAgentEndErrorMessage(
	event: Extract< AgentSessionEvent, { type: 'agent_end' } >
): string | null {
	const lastAssistant = findLastAssistant( event.messages );
	if ( ! lastAssistant ) {
		return null;
	}
	const errorText = lastAssistant.errorMessage?.trim();
	if ( errorText ) {
		return errorText;
	}
	const fallbackText = lastAssistant.content
		.filter( ( block ): block is { type: 'text'; text: string } => block.type === 'text' )
		.map( ( block ) => block.text )
		.join( '\n' )
		.trim();
	return fallbackText || null;
}
