import type { AiSessionEvent } from './types';

/**
 * Drop everything before the most recent `session.cleared` event — mirroring
 * what the user sees in the CLI when they clear the conversation. Called by
 * both the CLI replay loop and the UI session view so they agree on which
 * events belong to the "current" conversation.
 */
export function filterEventsAfterLastClear( events: AiSessionEvent[] ): AiSessionEvent[] {
	for ( let i = events.length - 1; i >= 0; i-- ) {
		if ( events[ i ].type === 'session.cleared' ) {
			return events.slice( i + 1 );
		}
	}
	return events;
}

/**
 * `ask_user` user messages are the agent's internal answers to its own
 * questions and should not be rendered as user prompts in the transcript.
 */
export function isVisibleUserMessage(
	event: Extract< AiSessionEvent, { type: 'user.message' } >
): boolean {
	return event.source === 'prompt';
}
