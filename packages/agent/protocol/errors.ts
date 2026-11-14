import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

// The proxy's refusals carry their code inside the message text, since the AI
// SDKs surface only the message string; these helpers key on those codes.

/**
 * The prefix the WordPress.com provider puts on the proxy's monthly cost-cap
 * 429. pi's retry classifier treats this phrase as non-retryable.
 */
export const USAGE_CAP_ERROR_PREFIX = 'Monthly usage limit reached';

const USAGE_CAP_PATTERN = new RegExp( `(?:${ USAGE_CAP_ERROR_PREFIX }|cost_cap_exceeded)`, 'i' );

/**
 * The monthly usage cap. A bare 429 doesn't match: an upstream rate limit or a
 * throttled API key clears on retry.
 */
export function isUsageCapError( message: string | undefined | null ): boolean {
	return USAGE_CAP_PATTERN.test( message ?? '' );
}

/**
 * Both credit pools are empty (STU-2236). Unlike the monthly cap, waiting for
 * the reset doesn't clear it: the user has to buy credits.
 */
export function isOutOfCreditsError( message: string | undefined | null ): boolean {
	return /studio_out_of_credits/i.test( message ?? '' );
}

// The per-account Studio Code AI kill switch (STU-2143).
export function isAiBlockedError( message: string | undefined | null ): boolean {
	return /studio_code_ai_disabled/i.test( message ?? '' );
}

// Studio Code AI beta access isn't enabled for the account (STU-2146).
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

/**
 * A provider error as people read it: the SDKs put the status and raw body in
 * the message (`529 {"type":"error","error":{…}}`), and Gemini nests another
 * JSON error inside its `message` string. This drops the status codes and
 * replaces the body with its innermost message. For display only: the helpers
 * above key on codes it drops.
 */
export function formatErrorMessage( message: string ): string {
	const start = message.indexOf( '{' );
	const end = message.lastIndexOf( '}' );
	const body = start === -1 ? undefined : messageFromJson( message.slice( start, end + 1 ) );
	if ( ! body ) {
		return message.trim();
	}
	const prefix = message
		.slice( 0, start )
		.replace( /\(?\b\d{3}\b\)?/g, '' )
		.replace( /[\s:]+$/, '' )
		.trim();
	return prefix ? `${ prefix }: ${ body }` : body;
}

function messageFromJson( text: string ): string | undefined {
	try {
		return messageFrom( JSON.parse( text ) );
	} catch {
		return undefined;
	}
}

function messageFrom( value: unknown ): string | undefined {
	if ( typeof value === 'string' ) {
		const text = value.trim();
		return ( text.startsWith( '{' ) && messageFromJson( text ) ) || text || undefined;
	}
	if ( ! value || typeof value !== 'object' ) {
		return undefined;
	}
	const { error, message, detail } = value as Record< string, unknown >;
	return (
		( typeof error === 'object' ? messageFrom( error ) : undefined ) ??
		messageFrom( message ) ??
		messageFrom( detail )
	);
}
