import {
	applyAssistantMessageDelta,
	type StreamingAssistantMessage,
} from '@studio/common/ai/streaming-message';
import type { AssistantMessageDelta } from '@studio/common/ai/json-events';

/**
 * The assistant reply still streaming into a session, rebuilt from the wire's
 * `message_update` deltas. UI-only: it never reaches the session cache, so it
 * can't be mistaken for (or duplicated next to) the final message, which
 * `message_end` appends to the transcript as it clears this.
 */
export interface StreamingReply {
	// Shared with the final entry, so the reply keeps its identity when it lands.
	entryId: string;
	timestamp: string;
	message: StreamingAssistantMessage;
}

export type StreamingReplyAction =
	| { type: 'stream_started'; entryId: string; timestamp: string }
	| {
			type: 'stream_deltas';
			deltas: AssistantMessageDelta[];
			// Used when the reply was joined midway (a reload mid-reply) and no
			// `message_start` was seen: the reply starts from the next delta.
			entryId: string;
			timestamp: string;
	  }
	| { type: 'stream_ended' };

export function streamingReplyReducer(
	state: StreamingReply | null,
	action: StreamingReplyAction
): StreamingReply | null {
	switch ( action.type ) {
		case 'stream_started':
			return { entryId: action.entryId, timestamp: action.timestamp, message: { content: [] } };
		case 'stream_deltas': {
			const base = state ?? {
				entryId: action.entryId,
				timestamp: action.timestamp,
				message: { content: [] },
			};
			const message = action.deltas.reduce( applyAssistantMessageDelta, base.message );
			if ( message === base.message ) {
				return state;
			}
			return { ...base, message };
		}
		case 'stream_ended':
			return null;
	}
}
