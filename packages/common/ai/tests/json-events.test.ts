import { describe, expect, it } from 'vitest';
import {
	buildUsageCapErrorMessage,
	getAgentEndFailure,
	isAiAccessRequiredError,
	isAiBlockedError,
	isOutOfCreditsError,
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

describe( 'isUsageCapError', () => {
	it( 'matches the canonical runtime-stamped prefix', () => {
		expect( isUsageCapError( buildUsageCapErrorMessage( '429 exceeded' ) ) ).toBe( true );
		expect( isUsageCapError( `${ USAGE_CAP_ERROR_PREFIX }: OpenAI API error (429): x` ) ).toBe(
			true
		);
	} );

	it( 'matches an un-rewritten proxy cost-cap code', () => {
		expect(
			isUsageCapError( 'OpenAI API error (429): {"error":{"code":"cost_cap_exceeded"}}' )
		).toBe( true );
		expect( isUsageCapError( '429 studio_cap_exceeded: Monthly cost cap exceeded.' ) ).toBe( true );
	} );

	// STU-2236: both credit pools empty is its own state — the fix is buying
	// credits, not waiting for the reset — so it must not read as the cap.
	it( 'does not match the out-of-credits refusal', () => {
		expect(
			isUsageCapError(
				"402 studio_out_of_credits: You've used your free monthly AI allowance and have no credits left."
			)
		).toBe( false );
	} );

	// A hosted upstream 429s for its own token-per-minute limits, which
	// retrying clears — those must not read as the monthly cap.
	it( 'does not match a 429 without the cost-cap code', () => {
		expect( isUsageCapError( 'API Error: 429 {"error":"x"}' ) ).toBe( false );
		expect( isUsageCapError( 'Request failed with status code 429' ) ).toBe( false );
		expect( isUsageCapError( '{"status": 429}' ) ).toBe( false );
	} );

	it( 'does not match raw un-rewritten 429s (non-wpcom rate limits)', () => {
		expect( isUsageCapError( '429 rate limited' ) ).toBe( false );
		expect( isUsageCapError( 'OpenAI API error (429): rate limited' ) ).toBe( false );
	} );
} );

describe( 'isOutOfCreditsError', () => {
	it( 'matches the load-bearing code token wherever it appears in the message', () => {
		expect(
			isOutOfCreditsError(
				"studio_out_of_credits: You've used your free monthly AI allowance and have no credits left. Buy credits in WordPress Studio to continue."
			)
		).toBe( true );
		expect(
			isOutOfCreditsError(
				'402 {"code":"studio_out_of_credits","message":"studio_out_of_credits: You\'ve used your free monthly AI allowance and have no credits left.","data":{"status":402}}'
			)
		).toBe( true );
	} );

	it( 'does not match the cap refusal or unrelated errors', () => {
		expect( isOutOfCreditsError( '429 studio_cap_exceeded: Monthly cost cap exceeded.' ) ).toBe(
			false
		);
		expect( isOutOfCreditsError( buildUsageCapErrorMessage( '429 exceeded' ) ) ).toBe( false );
		expect( isOutOfCreditsError( '402 payment required' ) ).toBe( false );
		expect( isOutOfCreditsError( '500 internal server error' ) ).toBe( false );
		expect( isOutOfCreditsError( undefined ) ).toBe( false );
		expect( isOutOfCreditsError( null ) ).toBe( false );
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
		expect(
			isAiBlockedError(
				'403 studio_code_ai_access_required: Studio Code AI access has not been enabled for this account.'
			)
		).toBe( false );
	} );
} );

describe( 'isAiAccessRequiredError', () => {
	it( 'matches the load-bearing code token wherever it appears in the message', () => {
		expect(
			isAiAccessRequiredError(
				'403 studio_code_ai_access_required: Studio Code AI access has not been enabled for this account.'
			)
		).toBe( true );
		expect(
			isAiAccessRequiredError(
				'403 {"code":"studio_code_ai_access_required","message":"Studio Code AI access has not been enabled for this account.","data":{"status":403}}'
			)
		).toBe( true );
	} );

	it( 'does not match the blocked code or unrelated errors', () => {
		expect(
			isAiAccessRequiredError(
				'403 studio_code_ai_disabled: Studio Code AI is blocked for this account.'
			)
		).toBe( false );
		expect( isAiAccessRequiredError( '403 model not allowed' ) ).toBe( false );
		expect( isAiAccessRequiredError( undefined ) ).toBe( false );
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
