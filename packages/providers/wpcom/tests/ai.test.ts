import { isRetryableAssistantError } from '@earendil-works/pi-ai';
import { describe, expect, it } from 'vitest';
import { ProviderNotReadyError } from '../../errors';
import { wpcomAi } from '../ai';
import type { AiConnection } from '../../types';
import type { AssistantMessage } from '@earendil-works/pi-ai';

const connect = ( model: 'fast' | 'balanced' | 'strong', sessionId?: string ) =>
	wpcomAi.connect( { config: { token: 'wpcom-token' }, userAgent: 'Studio/test' }, model, {
		sessionId,
	} );

function retryable( errorMessage: string ): boolean {
	return isRetryableAssistantError( {
		role: 'assistant',
		content: [],
		stopReason: 'error',
		errorMessage,
	} as unknown as AssistantMessage );
}

describe( 'wpcom ai', () => {
	it( 'asks for Studio sign-in without a config', async () => {
		const connection = wpcomAi.connect(
			{ config: undefined, userAgent: 'Studio/test' },
			'fast',
			{}
		);
		await expect( connection ).rejects.toBeInstanceOf( ProviderNotReadyError );
	} );

	it( 'routes the fast tier to Chat Completions with the proxy headers', async () => {
		const { apiKey, headers, model } = await connect( 'fast', 'session-2' );

		expect( apiKey ).toBe( 'wpcom-token' );
		expect( headers ).toEqual( {
			'User-Agent': 'Studio/test',
			'X-WPCOM-AI-Feature': 'studio-agent',
			'X-WPCOM-Session-ID': 'session-2',
		} );
		expect( model ).toMatchObject( {
			api: 'openai-completions',
			baseUrl: 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy/v1',
			input: [ 'text' ],
		} );
		// pi infers these from the base URL, which reads as plain OpenAI.
		expect( model.compat ).toMatchObject( {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsStrictMode: false,
			maxTokensField: 'max_tokens',
		} );
	} );

	it( 'routes balanced to Responses and strong to Messages under their upstream aliases', async () => {
		const balanced = await connect( 'balanced' );
		const strong = await connect( 'strong' );

		expect( balanced ).toMatchObject( {
			requestModelId: 'balanced-2',
			model: { api: 'openai-responses', input: [ 'text', 'image' ] },
		} );
		expect( balanced.model.compat ).toBeUndefined();
		expect( strong ).toMatchObject( {
			requestModelId: 'strong-2',
			model: {
				api: 'anthropic-messages',
				baseUrl: 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy',
				headers: { Authorization: 'Bearer wpcom-token' },
			},
		} );
	} );

	describe( 'rewriteError', () => {
		let rewriteError: NonNullable< AiConnection[ 'rewriteError' ] >;

		it( 'turns the cost-cap 429 into a usage-cap error pi does not retry', async () => {
			rewriteError = ( await connect( 'fast' ) ).rewriteError!;
			const message = rewriteError( '429 {"error":{"code":"cost_cap_exceeded"}}' );

			expect( message ).toBe(
				'Monthly usage limit reached: 429 {"error":{"code":"cost_cap_exceeded"}}'
			);
			expect( retryable( message! ) ).toBe( false );
		} );

		// Hosted upstreams 429 for their own rate limits, and those should keep retrying.
		it( 'leaves other 429s retryable', () => {
			expect( rewriteError( '429 {"error":{"type":"rate_limit_error"}}' ) ).toBeUndefined();
		} );

		// The `studio_out_of_credits` token is what the apps detect, and pi does
		// not retry it: only buying credits clears the state.
		it( 'passes the out-of-credits 402 through', () => {
			const message =
				'402 {"code":"studio_out_of_credits","message":"studio_out_of_credits: no credits left"}';

			expect( rewriteError( message ) ).toBeUndefined();
			expect( retryable( message ) ).toBe( false );
		} );
	} );
} );
