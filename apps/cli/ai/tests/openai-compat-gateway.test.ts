import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	compactMessagesIfNeeded,
	discoverContextWindow,
	estimateRequestTokens,
	findSplitIndex,
	type AnthropicMessage,
	type AnthropicMessagesRequest,
	type GatewayState,
	type OpenAiCompatibleConfig,
} from 'cli/ai/openai-compat-gateway';

const CONFIG: OpenAiCompatibleConfig = {
	baseUrl: 'http://localhost:9999/v1',
	model: 'test-model',
};

function textMessage( role: 'user' | 'assistant', text: string ): AnthropicMessage {
	return { role, content: text };
}

function toolUseMessage( id: string, name: string ): AnthropicMessage {
	return { role: 'assistant', content: [ { type: 'tool_use', id, name, input: {} } ] };
}

function toolResultMessage( toolUseId: string, text: string ): AnthropicMessage {
	return {
		role: 'user',
		content: [ { type: 'tool_result', tool_use_id: toolUseId, content: text } ],
	};
}

function baseRequest( messages: AnthropicMessage[] ): AnthropicMessagesRequest {
	return { model: 'test-model', messages, stream: false, max_tokens: 100 };
}

describe( 'discoverContextWindow', () => {
	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'reads context_window (Apfel-style)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue( {
				ok: true,
				json: async () => ( {
					data: [ { id: 'test-model', context_window: 4096 } ],
				} ),
			} )
		);

		await expect( discoverContextWindow( CONFIG ) ).resolves.toBe( 4096 );
	} );

	it( 'reads max_model_len (vLLM-style)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue( {
				ok: true,
				json: async () => ( {
					data: [ { id: 'test-model', max_model_len: 65536 } ],
				} ),
			} )
		);

		await expect( discoverContextWindow( CONFIG ) ).resolves.toBe( 65536 );
	} );

	it( 'falls back to the default when the field is missing', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue( {
				ok: true,
				json: async () => ( { data: [ { id: 'test-model' } ] } ),
			} )
		);

		await expect( discoverContextWindow( CONFIG ) ).resolves.toBe( 8192 );
	} );

	it( 'falls back to the default when the request fails', async () => {
		vi.stubGlobal( 'fetch', vi.fn().mockRejectedValue( new Error( 'network error' ) ) );

		await expect( discoverContextWindow( CONFIG ) ).resolves.toBe( 8192 );
	} );
} );

describe( 'estimateRequestTokens', () => {
	it( 'grows with message content length', () => {
		const small = estimateRequestTokens( baseRequest( [ textMessage( 'user', 'hi' ) ] ) );
		const large = estimateRequestTokens(
			baseRequest( [ textMessage( 'user', 'x'.repeat( 4000 ) ) ] )
		);

		expect( large ).toBeGreaterThan( small );
	} );
} );

describe( 'findSplitIndex', () => {
	it( 'never separates a tool_use message from its tool_result', () => {
		const messages = [
			textMessage( 'user', 'y'.repeat( 2000 ) ),
			toolUseMessage( 'tool_1', 'get_weather' ),
			toolResultMessage( 'tool_1', 'sunny' ),
			textMessage( 'assistant', 'done' ),
		];

		// A budget that would otherwise land the split between the tool_use and
		// tool_result messages (indices 1 and 2).
		const splitIndex = findSplitIndex( messages, 12 );

		expect( splitIndex ).toBeLessThanOrEqual( 1 );
	} );
} );

describe( 'compactMessagesIfNeeded', () => {
	beforeEach( () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue( {
				ok: true,
				json: async () => ( {
					choices: [ { message: { content: 'a concise summary' } } ],
				} ),
			} )
		);
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'leaves small requests untouched', async () => {
		const request = baseRequest( [ textMessage( 'user', 'hello' ) ] );
		const state: GatewayState = { contextWindow: 8192 };

		const result = await compactMessagesIfNeeded( request, CONFIG, state );

		expect( result ).toBe( request );
		expect( fetch ).not.toHaveBeenCalled();
	} );

	it( 'summarizes the oldest messages and keeps the recent tail verbatim', async () => {
		const oldMessages = Array.from( { length: 20 }, ( _, i ) =>
			textMessage( i % 2 === 0 ? 'user' : 'assistant', `old message ${ i }`.repeat( 50 ) )
		);
		const recentMessage = textMessage( 'user', 'what is the weather today?' );
		const request = baseRequest( [ ...oldMessages, recentMessage ] );
		const state: GatewayState = { contextWindow: 1450 };

		const result = await compactMessagesIfNeeded( request, CONFIG, state );

		expect( fetch ).toHaveBeenCalledWith(
			expect.stringContaining( '/chat/completions' ),
			expect.any( Object )
		);
		expect( result.messages ).toEqual( [ recentMessage ] );
		expect( result.system ).toContain( 'a concise summary' );
		expect( state.compaction?.summary ).toBe( 'a concise summary' );
	} );

	it( 'reuses the cached summary when the old chunk is unchanged', async () => {
		const oldMessages = Array.from( { length: 20 }, ( _, i ) =>
			textMessage( i % 2 === 0 ? 'user' : 'assistant', `old message ${ i }`.repeat( 50 ) )
		);
		const request = baseRequest( [ ...oldMessages, textMessage( 'user', 'first question' ) ] );
		const state: GatewayState = { contextWindow: 1450 };

		await compactMessagesIfNeeded( request, CONFIG, state );
		expect( fetch ).toHaveBeenCalledTimes( 1 );

		const secondRequest = baseRequest( [
			...oldMessages,
			textMessage( 'user', 'first question' ),
			textMessage( 'assistant', 'first answer' ),
			textMessage( 'user', 'second question' ),
		] );
		await compactMessagesIfNeeded( secondRequest, CONFIG, state );

		// The old chunk boundary hasn't grown, so no additional summarization call is made.
		expect( fetch ).toHaveBeenCalledTimes( 1 );
	} );

	it( 're-summarizes fully when the conversation diverges from the cached prefix', async () => {
		const oldMessages = Array.from( { length: 20 }, ( _, i ) =>
			textMessage( i % 2 === 0 ? 'user' : 'assistant', `old message ${ i }`.repeat( 50 ) )
		);
		const request = baseRequest( [ ...oldMessages, textMessage( 'user', 'first question' ) ] );
		const state: GatewayState = { contextWindow: 1450 };

		await compactMessagesIfNeeded( request, CONFIG, state );
		expect( fetch ).toHaveBeenCalledTimes( 1 );

		const divergedMessages = Array.from( { length: 20 }, ( _, i ) =>
			textMessage( i % 2 === 0 ? 'user' : 'assistant', `different message ${ i }`.repeat( 50 ) )
		);
		const divergedRequest = baseRequest( [
			...divergedMessages,
			textMessage( 'user', 'a totally different question' ),
		] );
		await compactMessagesIfNeeded( divergedRequest, CONFIG, state );

		expect( fetch ).toHaveBeenCalledTimes( 2 );
	} );
} );
