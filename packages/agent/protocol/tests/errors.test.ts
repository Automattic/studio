import { describe, expect, it } from 'vitest';
import {
	formatErrorMessage,
	getAgentEndFailure,
	isAiAccessRequiredError,
	isAiBlockedError,
	isOutOfCreditsError,
	isUsageCapError,
	USAGE_CAP_ERROR_PREFIX,
} from '@studio/agent/protocol/errors';
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
		model: 'claude-sonnet-5-5',
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
	it( "matches the provider's prefix and the proxy's cost-cap code", () => {
		expect( isUsageCapError( `${ USAGE_CAP_ERROR_PREFIX }: 429 exceeded` ) ).toBe( true );
		expect(
			isUsageCapError( 'OpenAI API error (429): {"error":{"code":"cost_cap_exceeded"}}' )
		).toBe( true );
	} );

	it( 'does not match other 429s or the out-of-credits refusal', () => {
		expect( isUsageCapError( 'OpenAI API error (429): rate limited' ) ).toBe( false );
		expect( isUsageCapError( 'API Error: 429 {"error":"x"}' ) ).toBe( false );
		expect( isUsageCapError( '402 studio_out_of_credits: No credits left.' ) ).toBe( false );
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
		expect( isOutOfCreditsError( '429 cost_cap_exceeded: Monthly cost cap exceeded.' ) ).toBe(
			false
		);
		expect( isOutOfCreditsError( `${ USAGE_CAP_ERROR_PREFIX }: 429 exceeded` ) ).toBe( false );
		expect( isOutOfCreditsError( '402 payment required' ) ).toBe( false );
		expect( isOutOfCreditsError( undefined ) ).toBe( false );
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

describe( 'formatErrorMessage', () => {
	it( "unwraps Gemini's error nested in its message string", () => {
		const message = JSON.stringify( {
			error: {
				message:
					'{\n "error": {\n "code": 503,\n "message": "This model is busy.",\n "status": "UNAVAILABLE"\n }\n}\n',
				code: 503,
				status: 'Service Unavailable',
			},
		} );
		expect( formatErrorMessage( message ) ).toBe( 'This model is busy.' );
	} );

	it( 'drops the status the Anthropic SDK puts before the body', () => {
		expect(
			formatErrorMessage(
				'529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_1"}'
			)
		).toBe( 'Overloaded' );
	} );

	it( 'keeps the text around the body', () => {
		expect(
			formatErrorMessage(
				'OpenAI API error (429): {"message":"Rate limit reached.","type":"requests"}'
			)
		).toBe( 'OpenAI API error: Rate limit reached.' );
	} );

	it( 'returns a message without a readable body unchanged', () => {
		expect( formatErrorMessage( ' Connection error. ' ) ).toBe( 'Connection error.' );
		expect( formatErrorMessage( '400 {"error":"invalid_grant"}' ) ).toBe(
			'400 {"error":"invalid_grant"}'
		);
		expect( formatErrorMessage( 'Bad template {name}' ) ).toBe( 'Bad template {name}' );
	} );
} );
