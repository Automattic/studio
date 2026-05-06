import { describe, expect, it, vi } from 'vitest';
import { piRuntime } from 'cli/ai/runtimes/pi';
import type { AiModelId } from '@studio/common/ai/models';

// Model-swap test uses a synthetic id outside `AI_MODELS`; route unknowns to
// 'openai' so the env credentials match.
vi.mock( '@studio/common/ai/models', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/common/ai/models') >();
	return {
		...actual,
		getAiModelFamily: ( id: string ) =>
			actual.isAiModelId( id ) ? actual.getAiModelFamily( id ) : 'openai',
	};
} );

const constructedAgents: Array< { state: { model: { id: string }; messages: unknown[] } } > = [];

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

describe( 'pi runtime', () => {
	it( 'yields an error when OPENAI_API_KEY is absent', async () => {
		const handle = piRuntime.run( {
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
		const handle = piRuntime.run( {
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

	// Reasoning models can produce a `thinking`-only turn; show the summary
	// so the UI doesn't render a silent empty "Done".
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

		const handle = piRuntime.run( {
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

	// `/model` swap mid-session must reach the next request — the prior cache
	// quietly served the old model.
	it( 'rebuilds the Agent when the model changes mid-session', async () => {
		constructedAgents.length = 0;
		const env = {
			OPENAI_API_KEY: 'sk-test',
			OPENAI_BASE_URL: 'https://proxy.example.com/v1',
		};
		const sessionId = 'fixed-session-id-for-swap-test';
		const otherOpenAiModel = 'gpt-test-other' as AiModelId;

		const first = piRuntime.run( { prompt: 'hi', env, model: 'gpt-5.5', resume: sessionId } );
		for await ( const _ of first );
		expect( constructedAgents ).toHaveLength( 1 );
		expect( constructedAgents[ 0 ].state.model.id ).toBe( 'gpt-5.5' );

		// `/model` swap — cache must NOT win.
		const second = piRuntime.run( {
			prompt: 'follow-up',
			env,
			model: otherOpenAiModel,
			resume: sessionId,
		} );
		for await ( const _ of second );
		expect( constructedAgents ).toHaveLength( 2 );
		expect( constructedAgents[ 1 ].state.model.id ).toBe( otherOpenAiModel );

		// Same model again — cache hits, no rebuild.
		const third = piRuntime.run( {
			prompt: 'still on the second model',
			env,
			model: otherOpenAiModel,
			resume: sessionId,
		} );
		for await ( const _ of third );
		expect( constructedAgents ).toHaveLength( 2 );
	} );

	// Silent header-drop would surface as an opaque 401 from the wpcom proxy.
	it( 'warns and continues when STUDIO_OPENAI_DEFAULT_HEADERS is malformed', async () => {
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		try {
			const handle = piRuntime.run( {
				prompt: 'hello',
				env: {
					OPENAI_API_KEY: 'sk-test',
					OPENAI_BASE_URL: 'https://proxy.example.com/v1',
					STUDIO_OPENAI_DEFAULT_HEADERS: '{not json',
				},
				model: 'gpt-5.5',
				resume: 'malformed-headers-' + Math.random(),
			} );
			for await ( const _ of handle ) {
				// Drain.
			}

			expect( warnSpy ).toHaveBeenCalledTimes( 1 );
			expect( warnSpy.mock.calls[ 0 ][ 0 ] ).toMatch(
				/STUDIO_OPENAI_DEFAULT_HEADERS.*malformed JSON/
			);
		} finally {
			warnSpy.mockRestore();
		}
	} );
} );
