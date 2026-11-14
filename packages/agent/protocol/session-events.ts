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

// A reply that ends the turn with neither text nor a tool call: the user
// sees nothing. Any model can do this; the fast tier does it when the model
// spends its whole reasoning budget (about 4,096 tokens) before answering.
export function isEmptyStop( message: AssistantMessage | undefined ): boolean {
	return Boolean(
		message &&
			message.stopReason === 'stop' &&
			! message.content.some(
				( block ) => block.type === 'toolCall' || ( block.type === 'text' && block.text.trim() )
			)
	);
}

// An empty stop ends the turn without the user seeing why. Resume it with a
// message the user doesn't see, up to this many times per turn.
export const MAX_EMPTY_STOP_CONTINUES = 2;

// pi leaves a reply that has only reasoning out of the next request, so the
// message carries that reasoning; otherwise the model starts the same reasoning
// over and runs out again.
export function getEmptyStopContinuation( message: AssistantMessage | undefined ): string {
	const reasoning = ( message?.content ?? [] )
		.map( ( block ) => ( block.type === 'thinking' ? block.thinking : '' ) )
		.join( '' )
		.trim();
	return reasoning
		? `Your reasoning was cut off before you replied. Continue from where it stopped:\n\n${ reasoning }`
		: 'continue';
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
