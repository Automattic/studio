import { describe, expect, it, vi } from 'vitest';
import { openaiRuntime } from 'cli/ai/runtimes/openai';
import type { AiModelId } from '@studio/common/ai/models';

// Module-level capture so the model-swap test can inspect every Agent the
// runtime instantiated across a sequence of `run()` calls.
const constructedAgents: Array< { state: { model: { id: string }; messages: unknown[] } } > = [];

// Tests can override the events the mock Agent emits per prompt(), to
// simulate weird model behavior (e.g. thinking-only turns) without
// re-mocking the whole module.
const DEFAULT_MOCK_EVENTS: unknown[] = [
	{
		type: 'message_end',
		message: {
			role: 'assistant',
			content: [ { type: 'text', text: 'mocked openai response' } ],
		},
	},
	{ type: 'turn_end', toolResults: [] },
	{ type: 'agent_end', messages: [] },
];
let nextMockEvents: unknown[] | null = null;

vi.mock( '@mariozechner/pi-agent-core', () => {
	class MockAgent {
		private listener?: ( event: unknown ) => void;
		public state: { model: { id: string }; messages: unknown[] };
		constructor(
			public options: { initialState?: { model?: { id?: string }; messages?: unknown[] } }
		) {
			this.state = {
				model: { id: options.initialState?.model?.id ?? '' },
				messages: options.initialState?.messages?.slice() ?? [],
			};
			constructedAgents.push( this );
		}
		subscribe( listener: ( event: unknown ) => void ): () => void {
			this.listener = listener;
			return () => {};
		}
		async prompt( _text: string ): Promise< void > {
			const events = nextMockEvents ?? DEFAULT_MOCK_EVENTS;
			nextMockEvents = null;
			for ( const event of events ) {
				this.listener?.( event );
			}
		}
		abort(): void {}
	}
	return { Agent: MockAgent };
} );

vi.mock( '@mariozechner/pi-coding-agent', () => {
	const stub = ( name: string ) => ( {
		name,
		label: name,
		description: name,
		parameters: {},
		execute: async () => ( { content: [ { type: 'text', text: '' } ], details: undefined } ),
	} );
	return {
		createReadTool: () => stub( 'Read' ),
		createWriteTool: () => stub( 'Write' ),
		createEditTool: () => stub( 'Edit' ),
		createBashTool: () => stub( 'Bash' ),
		createGrepTool: () => stub( 'Grep' ),
		createFindTool: () => stub( 'Glob' ),
		createLsTool: () => stub( 'Ls' ),
	};
} );

describe( 'OpenAI runtime POC', () => {
	it( 'yields an error when OPENAI_API_KEY is absent', async () => {
		const handle = openaiRuntime.run( {
			prompt: 'hello',
			env: {},
			model: 'gpt-5.5',
		} );

		const messages: Array< { type: string; subtype?: string } > = [];
		for await ( const m of handle ) {
			messages.push( { type: m.type, subtype: 'subtype' in m ? m.subtype : undefined } );
		}

		expect( messages ).toEqual( [
			{ type: 'system', subtype: 'init' },
			{ type: 'assistant', subtype: undefined },
			{ type: 'result', subtype: 'error_during_execution' },
		] );
	} );

	it( 'yields a full exchange when the mocked OpenAI SDK returns output', async () => {
		const handle = openaiRuntime.run( {
			prompt: 'hello',
			env: {
				OPENAI_API_KEY: 'sk-test',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
			model: 'gpt-5.5',
		} );

		const messages: Array< {
			type: string;
			subtype?: string;
			text?: string;
		} > = [];
		for await ( const m of handle ) {
			if ( m.type === 'assistant' ) {
				const content = m.message.content;
				const firstText = Array.isArray( content )
					? content.find( ( c ) => 'text' in c )
					: undefined;
				messages.push( {
					type: m.type,
					text: firstText && 'text' in firstText ? firstText.text : undefined,
				} );
			} else {
				messages.push( {
					type: m.type,
					subtype: 'subtype' in m ? m.subtype : undefined,
				} );
			}
		}

		expect( messages ).toEqual( [
			{ type: 'system', subtype: 'init' },
			{ type: 'assistant', text: 'mocked openai response' },
			{ type: 'result', subtype: 'success' },
		] );
	} );

	// Regression: with reasoning enabled, GPT-5+ models occasionally produce
	// a turn whose only content is `thinking` blocks — no text, no tool
	// calls. Without a fallback the UI would render an empty turn that shows
	// up as just "Done" with no body. We surface the thinking summary as the
	// assistant text so the user sees something.
	it( 'falls back to thinking content when there is no text and no tool calls', async () => {
		nextMockEvents = [
			{
				type: 'message_end',
				message: {
					role: 'assistant',
					content: [ { type: 'thinking', thinking: 'reasoned through it' } ],
				},
			},
			{ type: 'turn_end', toolResults: [] },
			{ type: 'agent_end', messages: [] },
		];

		const handle = openaiRuntime.run( {
			prompt: 'hello',
			env: {
				OPENAI_API_KEY: 'sk-test',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
			model: 'gpt-5.5',
			resume: 'thinking-only-' + Math.random(),
		} );

		const assistantTexts: string[] = [];
		for await ( const m of handle ) {
			if ( m.type === 'assistant' ) {
				const content = m.message.content;
				const firstText = Array.isArray( content )
					? content.find( ( c ) => 'text' in c )
					: undefined;
				if ( firstText && 'text' in firstText && typeof firstText.text === 'string' ) {
					assistantTexts.push( firstText.text );
				}
			}
		}

		expect( assistantTexts ).toEqual( [ 'reasoned through it' ] );
	} );

	// Regression: in CLI interactive mode the runtime kept a single Agent per
	// session forever. Switching models with `/model` flipped the dropdown
	// without rebuilding the Agent, so the new model id never reached the
	// next request. The fix: when the cached Agent's model differs from the
	// new request, rebuild the Agent (preserving messages so conversation
	// continues).
	//
	// We use a synthetic second model id (cast to AiModelId) so the test
	// covers the cache logic independent of which models AI_MODELS happens
	// to expose at any point in time.
	it( 'rebuilds the Agent when the model changes mid-session', async () => {
		constructedAgents.length = 0;
		const env = {
			OPENAI_API_KEY: 'sk-test',
			OPENAI_BASE_URL: 'https://proxy.example.com/v1',
		};
		const sessionId = 'fixed-session-id-for-swap-test';
		const otherOpenAiModel = 'gpt-test-other' as AiModelId;

		// First turn on gpt-5.5.
		const first = openaiRuntime.run( {
			prompt: 'hi',
			env,
			model: 'gpt-5.5',
			resume: sessionId,
		} );

		for await ( const _ of first ) {
			// Drain.
		}
		expect( constructedAgents ).toHaveLength( 1 );
		expect( constructedAgents[ 0 ].state.model.id ).toBe( 'gpt-5.5' );

		// Second turn on the same session id but a different model — this
		// is the `/model` swap. The cache must NOT win here.
		const second = openaiRuntime.run( {
			prompt: 'follow-up',
			env,
			model: otherOpenAiModel,
			resume: sessionId,
		} );

		for await ( const _ of second ) {
			// Drain.
		}
		expect( constructedAgents ).toHaveLength( 2 );
		expect( constructedAgents[ 1 ].state.model.id ).toBe( otherOpenAiModel );

		// Third turn on the same model — should hit the cache, not rebuild.
		const third = openaiRuntime.run( {
			prompt: 'still on the second model',
			env,
			model: otherOpenAiModel,
			resume: sessionId,
		} );

		for await ( const _ of third ) {
			// Drain.
		}
		expect( constructedAgents ).toHaveLength( 2 );
	} );
} );
