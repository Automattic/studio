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

// Raw HTTP 429 shapes as the SDKs format them: the Anthropic SDK produces
// "429 <body>", pi-ai's OpenAI path "OpenAI API error (429): <body>", plus
// legacy Claude Code SDK forms.
const HTTP_429_ERROR_PATTERN =
	/(?:^429\b|\(429\)|API Error:\s*429\b|status code\s+429\b|"status"\s*:\s*429\b)/i;

/**
 * Returns true when an error message reports an HTTP 429, whatever SDK
 * formatted it. Callers are responsible for provider gating: only on the
 * WordPress.com proxy does a 429 mean the usage cap.
 */
export function isHttp429ErrorMessage( message: string | undefined | null ): boolean {
	return HTTP_429_ERROR_PATTERN.test( message ?? '' );
}

const USAGE_CAP_PATTERN = new RegExp(
	`(?:${ USAGE_CAP_ERROR_PREFIX }|API Error:\\s*429\\b|status code\\s+429\\b|"status"\\s*:\\s*429\\b)`,
	'i'
);

/**
 * Returns true when an error message indicates the user hit the AI usage cap
 * (HTTP 429 from the WordPress.com proxy). Raw, un-rewritten 429 messages
 * (e.g. from a user-supplied Anthropic API key, where a 429 is a transient
 * rate limit rather than a monthly cap) intentionally don't match.
 */
export function isUsageCapError( message: string | undefined | null ): boolean {
	return USAGE_CAP_PATTERN.test( message ?? '' );
}

/**
 * Returns true when an error message reports the per-account Studio Code AI
 * kill switch (HTTP 403 with the `studio_ai_disabled` code from the
 * WordPress.com proxy, STU-2143).
 */
export function isAiBlockedError( message: string | undefined | null ): boolean {
	return /studio_ai_disabled/i.test( message ?? '' );
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
