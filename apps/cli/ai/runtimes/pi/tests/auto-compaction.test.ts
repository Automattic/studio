import { Agent, type AgentMessage } from '@mariozechner/pi-agent-core';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { runCompaction, shouldCompact, STUDIO_COMPACTION_SETTINGS } from '../auto-compaction';
import type { AssistantMessage, Model } from '@mariozechner/pi-ai';
import type { CompactionSettings } from '@mariozechner/pi-coding-agent';

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
		contextWindow: 100_000,
		maxTokens: 16_384,
		...overrides,
	};
}

function assistantMessage( overrides: Partial< AssistantMessage > = {} ): AssistantMessage {
	return {
		role: 'assistant',
		content: [ { type: 'text', text: 'response' } ],
		api: 'openai-completions',
		provider: 'openai',
		model: 'gpt-5.5',
		usage: {
			input: 1_000,
			output: 100,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 1_100,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: 'stop',
		timestamp: 1_000,
		...overrides,
	};
}

function buildAgent( messages: AgentMessage[] = [] ): Agent {
	return new Agent( {
		initialState: {
			model: buildModel(),
			systemPrompt: '',
			messages,
			tools: [],
			thinkingLevel: 'off',
		},
		getApiKey: () => 'sk-test',
	} );
}

const tightSettings: CompactionSettings = {
	enabled: true,
	reserveTokens: 1_000,
	keepRecentTokens: 100,
};

describe( 'shouldCompact', () => {
	it( 'returns null when settings are disabled', () => {
		expect(
			shouldCompact( assistantMessage(), buildModel(), {
				...STUDIO_COMPACTION_SETTINGS,
				enabled: false,
			} )
		).toBeNull();
	} );

	it( 'returns null for an aborted assistant', () => {
		expect(
			shouldCompact(
				assistantMessage( { stopReason: 'aborted' } ),
				buildModel(),
				STUDIO_COMPACTION_SETTINGS
			)
		).toBeNull();
	} );

	// Tight window: usage 1100 > usable (2000 - 1000 = 1000).
	it( 'returns "threshold" when usage tokens exceed the usable window', () => {
		expect(
			shouldCompact( assistantMessage(), buildModel( { contextWindow: 2_000 } ), tightSettings )
		).toBe( 'threshold' );
	} );

	it( 'returns "overflow" on a context-overflow error', () => {
		expect(
			shouldCompact(
				assistantMessage( {
					stopReason: 'error',
					errorMessage: 'prompt too long: maximum context length exceeded',
				} ),
				buildModel( { contextWindow: 2_000 } ),
				tightSettings
			)
		).toBe( 'overflow' );
	} );

	it( 'returns null for a non-overflow error response', () => {
		expect(
			shouldCompact(
				assistantMessage( { stopReason: 'error', errorMessage: '503 service unavailable' } ),
				buildModel( { contextWindow: 2_000 } ),
				tightSettings
			)
		).toBeNull();
	} );
} );

describe( 'runCompaction', () => {
	it( 'returns undefined when no entries can be cut past the keep-recent budget', async () => {
		generateSummaryMock.mockReset();
		const session = SessionManager.inMemory( '/tmp/test' );
		session.appendMessage( { role: 'user', content: 'hi', timestamp: 1 } );
		session.appendMessage( assistantMessage() );

		const result = await runCompaction( {
			agent: buildAgent(),
			sessionManager: session,
			model: buildModel(),
			apiKey: 'sk-test',
			settings: tightSettings,
			signal: new AbortController().signal,
			tokensBefore: 1_100,
		} );

		expect( result ).toBeUndefined();
		expect( generateSummaryMock ).not.toHaveBeenCalled();
	} );

	it( 'summarizes older turns, persists a compaction entry, and rewrites agent state', async () => {
		generateSummaryMock.mockReset();
		generateSummaryMock.mockResolvedValue( 'EARLIER WORK SUMMARY' );

		const session = SessionManager.inMemory( '/tmp/test' );
		const filler = 'x'.repeat( 200 );
		for ( let i = 0; i < 5; i += 1 ) {
			session.appendMessage( {
				role: 'user',
				content: `old user ${ i }: ${ filler }`,
				timestamp: i * 2,
			} );
			session.appendMessage(
				assistantMessage( {
					content: [ { type: 'text', text: `old asst ${ i }: ${ filler }` } ],
					timestamp: i * 2 + 1,
				} )
			);
		}
		session.appendMessage( { role: 'user', content: 'recent user', timestamp: 100 } );
		session.appendMessage( assistantMessage( { timestamp: 101 } ) );

		const agent = buildAgent( session.buildSessionContext().messages );

		const result = await runCompaction( {
			agent,
			sessionManager: session,
			model: buildModel(),
			apiKey: 'sk-test',
			settings: { enabled: true, reserveTokens: 100, keepRecentTokens: 50 },
			signal: new AbortController().signal,
			tokensBefore: 4_000,
		} );

		expect( generateSummaryMock ).toHaveBeenCalledTimes( 1 );
		expect( result?.summary ).toBe( 'EARLIER WORK SUMMARY' );
		expect( result?.tokensBefore ).toBe( 4_000 );

		const compactionEntry = session.getEntries().find( ( e ) => e.type === 'compaction' );
		expect( compactionEntry ).toBeDefined();
		if ( compactionEntry?.type === 'compaction' ) {
			expect( compactionEntry.summary ).toBe( 'EARLIER WORK SUMMARY' );
			expect( compactionEntry.firstKeptEntryId ).toBe( result?.firstKeptEntryId );
		}

		// `buildSessionContext` materializes the compaction entry as a
		// synthetic `compactionSummary` message at the head.
		expect( agent.state.messages.length ).toBeLessThan( 12 );
		expect( agent.state.messages[ 0 ].role ).toBe( 'compactionSummary' );
	} );
} );
