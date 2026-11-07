import { studioMessage } from '@studio/agent/node/studio-message';
import type { CallNotes } from './pending-work';
import type { AgentMessage } from '@earendil-works/pi-agent-core';

/**
 * Studio's checks of a call finish after its result, and the next result
 * carries their notes (its details' `callNotes`). Placed on the next result,
 * they read as that call's, and describe the sites before it changed them:
 * a palette's old colors right after the call that rewrote it. The context
 * has them on the result of the call they check instead, and on the result
 * that carries them when that one is gone, as a compacted context has.
 */
export function placeCallNotes( messages: AgentMessage[] ): AgentMessage[] {
	const calls = new Set(
		messages.flatMap( ( message ) =>
			message.role === 'toolResult' ? [ message.toolCallId ] : []
		)
	);
	// The notes each result gets: by the ID of the call it is, or the result itself.
	const placed = new Map< string | AgentMessage, string[] >();
	for ( const message of messages ) {
		if ( message.role !== 'toolResult' ) {
			continue;
		}
		const { callNotes = {} } = ( message.details ?? {} ) as { callNotes?: CallNotes };
		for ( const [ toolCallId, text ] of Object.entries( callNotes ) ) {
			const on = calls.has( toolCallId ) ? toolCallId : message;
			placed.set( on, [ ...( placed.get( on ) ?? [] ), text ] );
		}
	}
	if ( ! placed.size ) {
		return messages;
	}
	return messages.map( ( message ) => {
		const text =
			message.role === 'toolResult' &&
			studioMessage( 'notes', [
				...( placed.get( message.toolCallId ) ?? [] ),
				...( placed.get( message ) ?? [] ),
			] );
		return text && message.role === 'toolResult'
			? { ...message, content: [ ...message.content, { type: 'text' as const, text } ] }
			: message;
	} );
}
