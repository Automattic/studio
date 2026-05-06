import { Agent } from '@mariozechner/pi-agent-core';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { decideCompaction, runCompaction, STUDIO_COMPACTION_SETTINGS } from '../auto-compaction';
import type { AssistantMessage, Model, ToolResultMessage, UserMessage } from '@mariozechner/pi-ai';
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

function buildAgent(
	messages: ( UserMessage | AssistantMessage | ToolResultMessage )[] = []
): Agent {
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

describe( 'decideCompaction', () => {
	it( 'returns "none" when settings are disabled', () => {
		const session = SessionManager.inMemory( '/tmp/test' );
		const decision = decideCompaction( {
			assistantMessage: assistantMessage(),
			agent: buildAgent(),
			sessionManager: session,
			model: buildModel(),
			settings: { ...STUDIO_COMPACTION_SETTINGS, enabled: false },
			overflowRecoveryAttempted: false,
			skipAbortedCheck: true,
		} );
		expect( decision.kind ).toBe( 'none' );
	} );

	it( 'returns "none" for an aborted assistant when skipAbortedCheck=true', () => {
		const session = SessionManager.inMemory( '/tmp/test' );
		const decision = decideCompaction( {
			assistantMessage: assistantMessage( { stopReason: 'aborted' } ),
			agent: buildAgent(),
			sessionManager: session,
			model: buildModel(),
			settings: STUDIO_COMPACTION_SETTINGS,
			overflowRecoveryAttempted: false,
			skipAbortedCheck: true,
		} );
		expect( decision.kind ).toBe( 'none' );
	} );

	// Tight window so tokens (1100) > usableWindow (2000 - 1000 = 1000).
	it( 'returns "threshold" when usage tokens exceed the usable window', () => {
		const session = SessionManager.inMemory( '/tmp/test' );
		const decision = decideCompaction( {
			assistantMessage: assistantMessage(),
			agent: buildAgent(),
			sessionManager: session,
			model: buildModel( { contextWindow: 2_000 } ),
			settings: tightSettings,
			overflowRecoveryAttempted: false,
			skipAbortedCheck: true,
		} );
		expect( decision.kind ).toBe( 'threshold' );
	} );

	it( 'returns "overflow" when the assistant errored with a context-window message', () => {
		const session = SessionManager.inMemory( '/tmp/test' );
		const decision = decideCompaction( {
			assistantMessage: assistantMessage( {
				stopReason: 'error',
				errorMessage: 'prompt too long: maximum context length exceeded',
			} ),
			agent: buildAgent(),
			sessionManager: session,
			model: buildModel( { contextWindow: 2_000 } ),
			settings: tightSettings,
			overflowRecoveryAttempted: false,
			skipAbortedCheck: true,
		} );
		expect( decision.kind ).toBe( 'overflow' );
	} );

	it( 'returns "overflow_already_attempted" when recovery was already tried', () => {
		const session = SessionManager.inMemory( '/tmp/test' );
		const decision = decideCompaction( {
			assistantMessage: assistantMessage( {
				stopReason: 'error',
				errorMessage: 'prompt too long: maximum context length exceeded',
			} ),
			agent: buildAgent(),
			sessionManager: session,
			model: buildModel( { contextWindow: 2_000 } ),
			settings: tightSettings,
			overflowRecoveryAttempted: true,
			skipAbortedCheck: true,
		} );
		expect( decision.kind ).toBe( 'overflow_already_attempted' );
	} );

	// User swapped from a 50k model (which overflowed) to a 200k model:
	// the old overflow shouldn't trigger compaction on the new model.
	it( 'skips overflow detection when the message is from a different model', () => {
		const session = SessionManager.inMemory( '/tmp/test' );
		const decision = decideCompaction( {
			assistantMessage: assistantMessage( {
				model: 'old-model',
				stopReason: 'error',
				errorMessage: 'context length exceeded',
			} ),
			agent: buildAgent(),
			sessionManager: session,
			model: buildModel(),
			settings: STUDIO_COMPACTION_SETTINGS,
			overflowRecoveryAttempted: false,
			skipAbortedCheck: true,
		} );
		expect( decision.kind ).toBe( 'none' );
	} );

	it( 'returns "none" for an error message without overflow markers', () => {
		const session = SessionManager.inMemory( '/tmp/test' );
		const decision = decideCompaction( {
			assistantMessage: assistantMessage( {
				stopReason: 'error',
				errorMessage: '503 service unavailable',
			} ),
			agent: buildAgent(),
			sessionManager: session,
			model: buildModel( { contextWindow: 2_000 } ),
			settings: tightSettings,
			overflowRecoveryAttempted: false,
			skipAbortedCheck: true,
		} );
		expect( decision.kind ).toBe( 'none' );
	} );
} );

describe( 'runCompaction', () => {
	it( 'returns undefined when no entries can be cut past the keep-recent budget', async () => {
		generateSummaryMock.mockReset();
		const session = SessionManager.inMemory( '/tmp/test' );
		// Single short turn — keepRecentTokens=100 covers it entirely.
		session.appendMessage( {
			role: 'user',
			content: 'hi',
			timestamp: 1,
		} );
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
		// Five filler turns, then a recent turn — recent should survive.
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
			// Cut anywhere past the last ~50 chars worth of tail.
			settings: { enabled: true, reserveTokens: 100, keepRecentTokens: 50 },
			signal: new AbortController().signal,
			tokensBefore: 4_000,
		} );

		expect( generateSummaryMock ).toHaveBeenCalledTimes( 1 );
		expect( result ).toBeDefined();
		expect( result?.summary ).toBe( 'EARLIER WORK SUMMARY' );
		expect( result?.tokensBefore ).toBe( 4_000 );

		// JSONL contains the compaction entry, anchored to a real entry id.
		const compactionEntry = session.getEntries().find( ( e ) => e.type === 'compaction' );
		expect( compactionEntry ).toBeDefined();
		if ( compactionEntry?.type === 'compaction' ) {
			expect( compactionEntry.summary ).toBe( 'EARLIER WORK SUMMARY' );
			expect( compactionEntry.firstKeptEntryId ).toBe( result?.firstKeptEntryId );
		}

		// Agent state now reflects the compacted view: buildSessionContext
		// materializes a compaction entry as a synthetic compactionSummary
		// message at the head, followed by the kept tail.
		expect( agent.state.messages.length ).toBeLessThan( 12 );
		const head = agent.state.messages[ 0 ];
		expect( head.role ).toBe( 'compactionSummary' );
	} );
} );
