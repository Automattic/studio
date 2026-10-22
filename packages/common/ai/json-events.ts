import type { StudioChatArtifactData } from './chat-artifacts';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export type TurnCompletedStatus = 'success' | 'error' | 'paused' | 'max_turns';

/**
 * One step of a streaming assistant message, as sent over the wire. pi's
 * `message_update` carries the whole partial message on every token, so a long
 * reply would move quadratic bytes; the wire carries only what changed and
 * consumers rebuild the partial message themselves. `message_end` still
 * carries the full, final message.
 */
export type AssistantMessageDelta =
	| { type: 'text_start' | 'thinking_start'; contentIndex: number }
	| {
			type: 'text_delta' | 'thinking_delta' | 'toolcall_delta';
			contentIndex: number;
			delta: string;
	  }
	| { type: 'toolcall_start'; contentIndex: number; id: string; name: string }
	| { type: 'text_end' | 'thinking_end' | 'toolcall_end'; contentIndex: number };

export interface AgentMessageDeltaEvent {
	type: 'message_update';
	assistantMessageEvent: AssistantMessageDelta;
}

export type AgentWireEvent =
	| Exclude< AgentSessionEvent, { type: 'message_update' } >
	| AgentMessageDeltaEvent;

export interface AgentMessageJsonEvent {
	type: 'message';
	timestamp: string;
	message: AgentWireEvent;
}

/**
 * Convert a pi session event to its wire form: `message_update` drops the
 * partial message and keeps only the delta. Returns `null` for updates that
 * carry nothing a consumer needs (`start`, `done`, `error`: `message_start`
 * and `message_end` already cover them).
 */
export function toAgentWireEvent( event: AgentSessionEvent ): AgentWireEvent | null {
	if ( event.type !== 'message_update' ) {
		return event;
	}
	const update = event.assistantMessageEvent;
	let delta: AssistantMessageDelta;
	switch ( update.type ) {
		case 'text_start':
		case 'thinking_start':
		case 'text_end':
		case 'thinking_end':
		case 'toolcall_end':
			delta = { type: update.type, contentIndex: update.contentIndex };
			break;
		case 'text_delta':
		case 'thinking_delta':
		case 'toolcall_delta':
			delta = { type: update.type, contentIndex: update.contentIndex, delta: update.delta };
			break;
		case 'toolcall_start': {
			const block = update.partial?.content?.[ update.contentIndex ];
			delta = {
				type: 'toolcall_start',
				contentIndex: update.contentIndex,
				id: block?.type === 'toolCall' ? block.id : '',
				name: block?.type === 'toolCall' ? block.name : '',
			};
			break;
		}
		default:
			return null;
	}
	return { type: 'message_update', assistantMessageEvent: delta };
}

export type JsonEvent =
	| AgentMessageJsonEvent
	| { type: 'info'; timestamp: string; message: string }
	| { type: 'error'; timestamp: string; message: string }
	| { type: 'chat.artifact'; timestamp: string; artifact: StudioChatArtifactData }
	| {
			type: 'question.asked';
			timestamp: string;
			questions: Array< {
				question: string;
				options: Array< { label: string; description: string; image?: string } >;
				multiSelect?: boolean;
			} >;
	  }
	| { type: 'turn.started'; timestamp: string }
	| {
			type: 'turn.completed';
			timestamp: string;
			sessionId: string;
			status: TurnCompletedStatus;
			usage?: { numTurns: number; costUsd?: number };
	  };

/**
 * Canonical prefix the Studio agent runtime stamps on 429 errors from the
 * WordPress.com AI proxy. The exact phrase is load-bearing: pi's retry
 * classifier treats "Monthly usage limit reached" as a non-retryable
 * provider-limit error, and `isUsageCapError` keys on it across surfaces.
 */
export const USAGE_CAP_ERROR_PREFIX = 'Monthly usage limit reached';

export function buildUsageCapErrorMessage( originalMessage: string ): string {
	return `${ USAGE_CAP_ERROR_PREFIX }: ${ originalMessage }`;
}

const USAGE_CAP_PATTERN = new RegExp( `(?:${ USAGE_CAP_ERROR_PREFIX }|cost_cap_exceeded)`, 'i' );

/**
 * Returns true when an error message indicates the user hit the AI usage cap:
 * either the runtime stamped the canonical prefix, or the proxy's
 * `cost_cap_exceeded` code survived verbatim. A bare 429 deliberately doesn't
 * match — it may be a hosted upstream's rate limit, or a user-supplied API key
 * being throttled, and both of those are retryable.
 */
export function isUsageCapError( message: string | undefined | null ): boolean {
	return USAGE_CAP_PATTERN.test( message ?? '' );
}

/**
 * Returns true when a proxy error is the account's monthly cost cap rather than
 * a transient rate limit. Hosted upstreams behind the proxy return their own
 * 429s for token-per-minute limits, which retrying does clear, so the status
 * alone can't tell the two apart — the `cost_cap_exceeded` code can.
 */
export function isCostCapErrorMessage( message: string | undefined | null ): boolean {
	return /\bcost_cap_exceeded\b/i.test( message ?? '' );
}

/**
 * Returns true when the WordPress.com proxy refused the request because both
 * AI credit pools are empty — the free monthly allowance is used up and no
 * purchased credits remain (STU-2236). The proxy's 402 repeats the
 * `studio_out_of_credits` code inside its message text; as with the other
 * refusal codes, the AI SDKs surface only the message string, so the token is
 * the load-bearing marker. Distinct from the monthly cap on purpose: waiting
 * for the reset doesn't clear this state — the user has to buy credits.
 */
export function isOutOfCreditsError( message: string | undefined | null ): boolean {
	return /studio_out_of_credits/i.test( message ?? '' );
}

/**
 * Returns true when an error message reports the per-account Studio Code AI
 * kill switch (STU-2143). The WordPress.com proxy's 403 must carry the
 * `studio_code_ai_disabled` code inside its `message` text — the AI SDKs
 * surface only the message string, so the token is load-bearing there, same
 * as `USAGE_CAP_ERROR_PREFIX` for 429s.
 */
export function isAiBlockedError( message: string | undefined | null ): boolean {
	return /studio_code_ai_disabled/i.test( message ?? '' );
}

/**
 * Returns true when an error message reports that Studio Code AI beta access
 * hasn't been enabled for the account (STU-2146). Same mechanism as
 * `isAiBlockedError`: the WordPress.com proxy stamps the
 * `studio_code_ai_access_required` code into the message text, since the AI
 * SDKs surface only the message string.
 */
export function isAiAccessRequiredError( message: string | undefined | null ): boolean {
	return /studio_code_ai_access_required/i.test( message ?? '' );
}

/**
 * Extract the failure of a completed turn from its final `agent_end` event.
 * The error text lives on the last assistant message's `errorMessage`
 * (streamed API failures) or its text blocks (synthetic pre-flight errors).
 * Returns `null` for successful, interrupted, or will-retry ends — and a
 * possibly-empty `message` for failures, so callers can show fallback copy.
 */
export function getAgentEndFailure(
	event: AgentSessionEvent | AgentWireEvent
): { message: string } | null {
	if ( event.type !== 'agent_end' || event.willRetry ) {
		return null;
	}
	for ( let index = event.messages.length - 1; index >= 0; index -= 1 ) {
		const message = event.messages[ index ];
		if ( message.role !== 'assistant' ) {
			continue;
		}
		if ( message.stopReason !== 'error' ) {
			return null;
		}
		const fromErrorField = message.errorMessage?.trim();
		if ( fromErrorField ) {
			return { message: fromErrorField };
		}
		const fromTextBlocks = message.content
			.filter( ( block ): block is { type: 'text'; text: string } => block.type === 'text' )
			.map( ( block ) => block.text )
			.join( '\n' )
			.trim();
		return { message: fromTextBlocks };
	}
	return null;
}
