import {
	createAssistantMessageEventStream,
	isRetryableAssistantError,
} from '@earendil-works/pi-ai';
import { isOutOfCreditsError, USAGE_CAP_ERROR_PREFIX } from '@studio/common/ai/json-events';
import { describe, expect, it } from 'vitest';
import { withUsageCapErrorRewrite } from '../usage-cap';
import type { AssistantMessage } from '@earendil-works/pi-ai';

// The proxy's 402 body, as the Anthropic/OpenAI SDKs flatten it into the
// error message (STU-2236).
const OUT_OF_CREDITS_MESSAGE =
	'402 {"code":"studio_out_of_credits","message":"studio_out_of_credits: You\'ve used your free monthly AI allowance and have no credits left. Buy credits in WordPress Studio to continue.","data":{"status":402}}';

function errorMessageWith( errorMessage: string ): AssistantMessage {
	return {
		role: 'assistant',
		content: [],
		api: 'anthropic-messages',
		provider: 'studio-wpcom-anthropic',
		model: 'claude-sonnet-5',
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'error',
		errorMessage,
		timestamp: 0,
	} as AssistantMessage;
}

describe( 'withUsageCapErrorRewrite', () => {
	it( 'stamps the usage-cap prefix on cost-cap 429 error events', async () => {
		const source = createAssistantMessageEventStream();
		const wrapped = withUsageCapErrorRewrite( source );
		source.push( {
			type: 'error',
			reason: 'error',
			error: errorMessageWith( '429 {"error":{"code":"cost_cap_exceeded"}}' ),
		} );
		source.end();

		const result = await wrapped.result();
		expect( result.errorMessage ).toBe(
			`${ USAGE_CAP_ERROR_PREFIX }: 429 {"error":{"code":"cost_cap_exceeded"}}`
		);
	} );

	// Hosted upstreams 429 for their own rate limits. Stamping the prefix would
	// make pi treat those as non-retryable, killing a retry that would succeed.
	it( 'leaves a 429 without the cost-cap code retryable', async () => {
		const source = createAssistantMessageEventStream();
		const wrapped = withUsageCapErrorRewrite( source );
		source.push( {
			type: 'error',
			reason: 'error',
			error: errorMessageWith( '429 {"error":{"type":"rate_limit_error"}}' ),
		} );
		source.end();

		const result = await wrapped.result();
		expect( result.errorMessage ).toBe( '429 {"error":{"type":"rate_limit_error"}}' );
	} );

	// The out-of-credits 402 (STU-2236) keeps its message verbatim — the
	// `studio_out_of_credits` token in it is what the UI surfaces detect —
	// and pi must not auto-retry it: only buying credits clears the state.
	it( 'passes the out-of-credits 402 through unrewritten and non-retryable', async () => {
		const source = createAssistantMessageEventStream();
		const wrapped = withUsageCapErrorRewrite( source );
		source.push( {
			type: 'error',
			reason: 'error',
			error: errorMessageWith( OUT_OF_CREDITS_MESSAGE ),
		} );
		source.end();

		const result = await wrapped.result();
		expect( result.errorMessage ).toBe( OUT_OF_CREDITS_MESSAGE );
		expect( isOutOfCreditsError( result.errorMessage ) ).toBe( true );
		expect( isRetryableAssistantError( result ) ).toBe( false );
	} );

	it( 'leaves non-429 errors untouched', async () => {
		const source = createAssistantMessageEventStream();
		const wrapped = withUsageCapErrorRewrite( source );
		source.push( {
			type: 'error',
			reason: 'error',
			error: errorMessageWith( '500 internal server error' ),
		} );
		source.end();

		const result = await wrapped.result();
		expect( result.errorMessage ).toBe( '500 internal server error' );
	} );
} );
