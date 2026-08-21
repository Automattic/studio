import type { StudioChatArtifactData } from './chat-artifacts';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export type TurnCompletedStatus = 'success' | 'error' | 'paused' | 'max_turns';

// User-facing media payload emitted by tools like `share_screenshot`. The remote
// session controller forwards these to Telegram as photos; other consumers
// (desktop renderer, plain CLI) can ignore them.
export interface MediaShareEvent {
	type: 'media.share';
	timestamp: string;
	mediaType: 'image';
	mimeType: 'image/png' | 'image/jpeg';
	dataBase64: string;
	caption?: string;
}

export interface AgentMessageJsonEvent {
	type: 'message';
	timestamp: string;
	message: AgentSessionEvent;
}

export type JsonEvent =
	| AgentMessageJsonEvent
	| { type: 'progress'; timestamp: string; message: string }
	| { type: 'info'; timestamp: string; message: string }
	| { type: 'error'; timestamp: string; message: string }
	| { type: 'chat.artifact'; timestamp: string; artifact: StudioChatArtifactData }
	| { type: 'preview.reload'; timestamp: string }
	| {
			type: 'question.asked';
			timestamp: string;
			questions: Array< {
				question: string;
				options: Array< { label: string; description: string } >;
			} >;
	  }
	| { type: 'turn.started'; timestamp: string }
	| {
			type: 'turn.completed';
			timestamp: string;
			sessionId: string;
			status: TurnCompletedStatus;
			usage?: { numTurns: number; costUsd?: number };
	  }
	| MediaShareEvent;

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
export function getAgentEndFailure( event: AgentSessionEvent ): { message: string } | null {
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
