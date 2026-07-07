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
