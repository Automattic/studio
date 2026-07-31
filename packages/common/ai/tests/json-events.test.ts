import { describe, expect, it } from 'vitest';
import {
	buildUsageCapErrorMessage,
	getAgentEndFailure,
	isHttp429ErrorMessage,
	isAiBlockedError,
	isUsageCapError,
	USAGE_CAP_ERROR_PREFIX,
} from '../json-events';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

function assistantMessage(
	overrides: Partial< {
		stopReason: string;
		errorMessage: string;
		content: Array< { type: string; text?: string } >;
	} >
) {
	return {
		role: 'assistant',
		content: [],
		api: 'anthropic-messages',
		provider: 'anthropic',
		model: 'claude-sonnet-5',
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'stop',
		timestamp: 0,
		...overrides,
	};
}

function agentEnd(
	messages: unknown[],
	{ willRetry = false }: { willRetry?: boolean } = {}
): AgentSessionEvent {
	return { type: 'agent_end', willRetry, messages } as unknown as AgentSessionEvent;
}

describe( 'isHttp429ErrorMessage', () => {
	it.each( [
		// Anthropic SDK: "<status> <message or JSON body>".
		'429 {"type":"error","error":{"type":"rate_limit_error","message":"exceeded"}}',
		'429 Number of requests has exceeded your monthly limit',
		'429 status code (no body)',
		// pi-ai OpenAI Responses formatting.
		'OpenAI API error (429): {"error":{"message":"exceeded"}}',
		// Legacy Claude Code SDK formatting.
		'API Error: 429 {"error":"exceeded"}',
	] )( 'matches %s', ( message ) => {
		expect( isHttp429ErrorMessage( message ) ).toBe( true );
	} );

	it.each( [
		'500 internal server error',
		'Request took 429 ms',
		'API Error: 500 upstream failure',
		undefined,
		null,
		'',
	] )( 'does not match %s', ( message ) => {
		expect( isHttp429ErrorMessage( message ) ).toBe( false );
	} );
} );

describe( 'isUsageCapError', () => {
	it( 'matches the canonical runtime-stamped prefix', () => {
		expect( isUsageCapError( buildUsageCapErrorMessage( '429 exceeded' ) ) ).toBe( true );
		expect( isUsageCapError( `${ USAGE_CAP_ERROR_PREFIX }: OpenAI API error (429): x` ) ).toBe(
			true
		);
	} );

	it( 'matches legacy Claude Code SDK formats', () => {
		expect( isUsageCapError( 'API Error: 429 {"error":"x"}' ) ).toBe( true );
		expect( isUsageCapError( 'Request failed with status code 429' ) ).toBe( true );
		expect( isUsageCapError( '{"status": 429}' ) ).toBe( true );
	} );

	it( 'does not match raw un-rewritten 429s (non-wpcom rate limits)', () => {
		expect( isUsageCapError( '429 rate limited' ) ).toBe( false );
		expect( isUsageCapError( 'OpenAI API error (429): rate limited' ) ).toBe( false );
	} );
} );

describe( 'isAiBlockedError', () => {
	it( 'matches the load-bearing code token wherever it appears in the message', () => {
		expect(
			isAiBlockedError( '403 studio_code_ai_disabled: Studio Code AI is blocked for this account.' )
		).toBe( true );
		expect(
			isAiBlockedError(
				'403 {"code":"studio_code_ai_disabled","message":"Studio Code AI is blocked for this account.","data":{"status":403}}'
			)
		).toBe( true );
	} );

	it( 'does not match other 403s or unrelated errors', () => {
		expect( isAiBlockedError( '403 model not allowed' ) ).toBe( false );
		expect( isAiBlockedError( '403 Studio Code AI is blocked for this account.' ) ).toBe( false );
		expect( isAiBlockedError( 'Monthly usage limit reached: x' ) ).toBe( false );
		expect( isAiBlockedError( undefined ) ).toBe( false );
	} );
} );

describe( 'getAgentEndFailure', () => {
	it( 'returns the errorMessage of the final errored assistant message', () => {
		const event = agentEnd( [
			assistantMessage( {} ),
			assistantMessage( { stopReason: 'error', errorMessage: '429 exceeded' } ),
		] );
		expect( getAgentEndFailure( event ) ).toEqual( { message: '429 exceeded' } );
	} );

	it( 'falls back to text blocks for synthetic errors without errorMessage', () => {
		const event = agentEnd( [
			assistantMessage( {
				stopReason: 'error',
				content: [ { type: 'text', text: 'Login required.' } ],
			} ),
		] );
		expect( getAgentEndFailure( event ) ).toEqual( { message: 'Login required.' } );
	} );

	it( 'returns an empty message for errors with no text at all', () => {
		const event = agentEnd( [ assistantMessage( { stopReason: 'error' } ) ] );
		expect( getAgentEndFailure( event ) ).toEqual( { message: '' } );
	} );

	it( 'returns null for successful and interrupted turns', () => {
		expect( getAgentEndFailure( agentEnd( [ assistantMessage( {} ) ] ) ) ).toBeNull();
		expect(
			getAgentEndFailure( agentEnd( [ assistantMessage( { stopReason: 'aborted' } ) ] ) )
		).toBeNull();
	} );

	it( 'returns null when the turn will be retried', () => {
		const event = agentEnd(
			[ assistantMessage( { stopReason: 'error', errorMessage: '500 flaky' } ) ],
			{ willRetry: true }
		);
		expect( getAgentEndFailure( event ) ).toBeNull();
	} );
} );
