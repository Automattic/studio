import { describe, expect, it, vi } from 'vitest';
import { buildTransformContext } from '../compaction';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';

const generateSummaryMock = vi.fn< ( ...args: unknown[] ) => Promise< string > >();

vi.mock( '@mariozechner/pi-coding-agent', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@mariozechner/pi-coding-agent') >();
	return {
		...actual,
		generateSummary: ( ...args: unknown[] ) => generateSummaryMock( ...args ),
	};
} );

function buildModel(
	overrides: Partial< Model< 'openai-completions' > > = {}
): Model< 'openai-completions' > {
	return {
		id: 'gpt-5.5',
		name: 'gpt-5.5',
		api: 'openai-completions',
		provider: 'openai',
		baseUrl: 'https://example.com/v1',
		reasoning: false,
		input: [ 'text' ],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		// Tight window so tests trigger compaction without MB of fixture text.
		contextWindow: 1_000,
		maxTokens: 256,
		...overrides,
	};
}

function userMessage( text: string, ts = 0 ): AgentMessage {
	return { role: 'user', content: text, timestamp: ts };
}

function assistantMessage( text: string, ts = 0 ): AgentMessage {
	return {
		role: 'assistant',
		content: [ { type: 'text', text } ],
		api: 'openai-completions',
		provider: 'openai',
		model: 'gpt-5.5',
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'stop',
		timestamp: ts,
	};
}

describe( 'OpenAI runtime compaction', () => {
	it( 'returns messages unchanged when below the compaction threshold', async () => {
		generateSummaryMock.mockReset();
		const transform = buildTransformContext( {
			model: buildModel(),
			apiKey: 'sk-test',
		} );

		const messages: AgentMessage[] = [ userMessage( 'hi', 1 ), assistantMessage( 'hello', 2 ) ];

		const result = await transform( messages );
		expect( result ).toBe( messages );
		expect( generateSummaryMock ).not.toHaveBeenCalled();
	} );

	it( 'summarizes older messages and keeps recent context when over threshold', async () => {
		generateSummaryMock.mockReset();
		generateSummaryMock.mockResolvedValue( 'EARLIER WORK SUMMARY' );

		// `estimateTokens` ≈ chars/4: 5 user/asst pairs of 4k filler exceeds
		// the (8k window − 1k reserve) threshold with a ≥2k recent-tail cut.
		const filler = 'a'.repeat( 4_000 );
		const transform = buildTransformContext( {
			model: buildModel( { contextWindow: 8_000 } ),
			apiKey: 'sk-test',
			settings: { reserveTokens: 1_000, keepRecentTokens: 2_000 },
		} );

		const messages: AgentMessage[] = [];
		for ( let i = 0; i < 5; i++ ) {
			messages.push( userMessage( `old user ${ i }: ${ filler }`, i * 2 ) );
			messages.push( assistantMessage( `old asst ${ i }: ${ filler }`, i * 2 + 1 ) );
		}
		// Recent tail — these should survive the cut.
		messages.push( userMessage( `recent user 1: ${ filler }`, 100 ) );
		messages.push( assistantMessage( 'recent asst 1', 101 ) );
		messages.push( userMessage( 'recent user 2', 102 ) );
		messages.push( assistantMessage( 'recent asst 2', 103 ) );

		const result = await transform( messages );

		expect( generateSummaryMock ).toHaveBeenCalledTimes( 1 );
		expect( result ).not.toBe( messages );
		// First message must be the synthetic summary.
		expect( result[ 0 ].role ).toBe( 'user' );
		expect( ( result[ 0 ] as { content: string } ).content ).toContain( 'EARLIER WORK SUMMARY' );
		const lastFour = result.slice( -4 );
		expect( lastFour ).toEqual( messages.slice( -4 ) );
	} );

	it( 'returns the original messages when summarization throws', async () => {
		generateSummaryMock.mockReset();
		generateSummaryMock.mockRejectedValue( new Error( 'proxy 500' ) );

		const filler = 'a'.repeat( 4_000 );
		const transform = buildTransformContext( {
			model: buildModel( { contextWindow: 8_000 } ),
			apiKey: 'sk-test',
			settings: { reserveTokens: 1_000, keepRecentTokens: 2_000 },
		} );

		const messages: AgentMessage[] = [];
		for ( let i = 0; i < 5; i++ ) {
			messages.push( userMessage( `u${ i }: ${ filler }`, i * 2 ) );
			messages.push( assistantMessage( `a${ i }: ${ filler }`, i * 2 + 1 ) );
		}
		messages.push( userMessage( `recent: ${ filler }`, 100 ) );

		const result = await transform( messages );
		expect( result ).toBe( messages );
	} );

	it( 'fires the lifecycle callback for start and end on a successful run', async () => {
		generateSummaryMock.mockReset();
		generateSummaryMock.mockResolvedValue( 'SUMMARY' );

		const phases: string[] = [];
		const filler = 'a'.repeat( 4_000 );
		const transform = buildTransformContext( {
			model: buildModel( { contextWindow: 8_000 } ),
			apiKey: 'sk-test',
			settings: { reserveTokens: 1_000, keepRecentTokens: 2_000 },
			onLifecycle: ( phase ) => phases.push( phase ),
		} );

		const messages: AgentMessage[] = [];
		for ( let i = 0; i < 5; i++ ) {
			messages.push( userMessage( `u${ i }: ${ filler }`, i * 2 ) );
			messages.push( assistantMessage( `a${ i }: ${ filler }`, i * 2 + 1 ) );
		}
		messages.push( userMessage( `recent: ${ filler }`, 100 ) );

		await transform( messages );
		expect( phases ).toEqual( [ 'start', 'end' ] );
	} );

	// Don't cut between a tool_use and its tool_result.
	it( 'skips compaction when the last message is a toolResult (mid-turn safeguard)', async () => {
		generateSummaryMock.mockReset();
		generateSummaryMock.mockResolvedValue( 'SHOULD NOT BE CALLED' );

		const filler = 'a'.repeat( 4_000 );
		const transform = buildTransformContext( {
			model: buildModel( { contextWindow: 8_000 } ),
			apiKey: 'sk-test',
			settings: { reserveTokens: 1_000, keepRecentTokens: 2_000 },
		} );

		const messages: AgentMessage[] = [];
		for ( let i = 0; i < 5; i++ ) {
			messages.push( userMessage( `u${ i }: ${ filler }`, i * 2 ) );
			messages.push( assistantMessage( `a${ i }: ${ filler }`, i * 2 + 1 ) );
		}
		// Dangling toolResult — assistant is about to follow up on it.
		messages.push( {
			role: 'toolResult',
			toolCallId: 'call_1',
			toolName: 'noop',
			content: [ { type: 'text', text: 'tool ran' } ],
			isError: false,
			timestamp: 99,
		} );

		const result = await transform( messages );
		expect( result ).toBe( messages );
		expect( generateSummaryMock ).not.toHaveBeenCalled();
	} );

	// Defaults are sized for 200k+ windows; on tighter windows they must scale
	// down, not crowd out the prompt budget.
	it( 'caps reserve and keep-recent against a narrow context window', async () => {
		generateSummaryMock.mockReset();
		generateSummaryMock.mockResolvedValue( 'SUMMARY' );

		const filler = 'a'.repeat( 4_000 );
		// Defaults (16k/20k) on a 10k window — exercise the cap behavior.
		const transform = buildTransformContext( {
			model: buildModel( { contextWindow: 10_000 } ),
			apiKey: 'sk-test',
		} );

		const messages: AgentMessage[] = [];
		for ( let i = 0; i < 5; i++ ) {
			messages.push( userMessage( `u${ i }: ${ filler }`, i * 2 ) );
			messages.push( assistantMessage( `a${ i }: ${ filler }`, i * 2 + 1 ) );
		}
		messages.push( userMessage( `recent: ${ filler }`, 100 ) );

		const result = await transform( messages );
		expect( generateSummaryMock ).toHaveBeenCalledTimes( 1 );
		expect( result ).not.toBe( messages );
		expect( result.length ).toBeLessThan( messages.length );
		expect( result[ 0 ].role ).toBe( 'user' );
		expect( ( result[ 0 ] as { content: string } ).content ).toContain( 'SUMMARY' );
	} );
} );
