import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

/**
 * Studio's checks of the sites a turn changed run when the agent's reply would
 * end the turn. When they find problems open, the turn continues from before
 * that reply: the user does not see it, and the agent's context goes from its
 * last call to the checks, as if they had come before it replied. Its reply
 * once they are resolved is the one that ends the turn.
 */
export const OPEN_PROBLEMS_TYPE = 'studio.open_problems';

/** Whether an event is the end of a reply that ends the turn, unless Studio continues it. */
export function endsTurn( event: AgentSessionEvent ): boolean {
	return (
		event.type === 'message_end' &&
		event.message.role === 'assistant' &&
		event.message.stopReason === 'stop'
	);
}

/** A held event as it reaches the user once the turn continues: its reply's text gone, its thinking and usage kept. */
export function withoutReplyText( event: AgentSessionEvent ): AgentSessionEvent {
	if (
		( event.type !== 'message_end' && event.type !== 'turn_end' ) ||
		event.message.role !== 'assistant'
	) {
		return event;
	}
	return {
		...event,
		message: {
			...event.message,
			content: event.message.content.filter( ( block ) => block.type !== 'text' ),
		},
	} as AgentSessionEvent;
}

/** The context without the replies the turn continued from before. */
export function withoutContinuedReplies( messages: AgentMessage[] ): AgentMessage[] {
	return messages.filter( ( message, index ) => {
		const next = messages[ index + 1 ] as { role?: string; customType?: string } | undefined;
		return ! (
			message.role === 'assistant' &&
			next?.role === 'custom' &&
			next.customType === OPEN_PROBLEMS_TYPE
		);
	} );
}
