import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { USAGE_CAP_ERROR_PREFIX } from '@studio/common/ai/json-events';
import { describe, expect, it } from 'vitest';
import { withUsageCapErrorRewrite } from '../usage-cap';
import type { AssistantMessage } from '@earendil-works/pi-ai';

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
