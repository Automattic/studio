import { SessionManager } from '@mariozechner/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { piRuntime } from 'cli/ai/runtimes/pi';
import type { AiModelId } from '@studio/common/ai/models';
import type { AgentRuntimeEvent } from 'cli/ai/runtimes/runtime-events';

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
			timestamp: 0,
		},
	},
	{
		type: 'turn_end',
		message: {
			role: 'assistant',
			content: [ { type: 'text', text: 'mocked openai response' } ],
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
			timestamp: 0,
		},
		toolResults: [],
	},
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

vi.mock( '@mariozechner/pi-coding-agent', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@mariozechner/pi-coding-agent') >();
	const stub = ( name: string ) => ( {
		name,
		label: name,
		description: name,
		parameters: {},
		execute: async () => ( { content: [ { type: 'text', text: '' } ], details: undefined } ),
	} );
	return {
		...actual,
		createReadTool: () => stub( 'Read' ),
		createWriteTool: () => stub( 'Write' ),
		createEditTool: () => stub( 'Edit' ),
		createBashTool: () => stub( 'Bash' ),
		createGrepTool: () => stub( 'Grep' ),
		createFindTool: () => stub( 'Glob' ),
		createLsTool: () => stub( 'Ls' ),
	};
} );

const newSession = () => SessionManager.inMemory( '/tmp/eval' );

const findAssistantText = ( events: AgentRuntimeEvent[] ): string | undefined => {
	for ( const e of events ) {
		if ( e.type === 'message_end' && e.message.role === 'assistant' ) {
			for ( const block of e.message.content ) {
				if ( block.type === 'text' ) return block.text;
			}
		}
	}
	return undefined;
};

describe( 'pi runtime', () => {
	it( 'yields turn_completed with the credential error in `result` when OPENAI_API_KEY is absent', async () => {
		const handle = piRuntime.run( {
			prompt: 'hello',
			env: {},
			model: 'gpt-5.5',
			session: newSession(),
		} );

		const events: AgentRuntimeEvent[] = [];
		for await ( const e of handle ) {
			events.push( e );
		}

		expect( events ).toHaveLength( 1 );
		const final = events[ 0 ];
		expect( final.type ).toBe( 'turn_completed' );
		if ( final.type === 'turn_completed' ) {
			expect( final.subtype ).toBe( 'error_during_execution' );
			expect( final.isError ).toBe( true );
			expect( final.result ).toMatch( /OPENAI_API_KEY/ );
		}
	} );

	it( 'yields a full exchange when the mocked OpenAI SDK returns output', async () => {
		const handle = piRuntime.run( {
			prompt: 'hello',
			env: {
				OPENAI_API_KEY: 'sk-test',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
			model: 'gpt-5.5',
			session: newSession(),
		} );

		const events: AgentRuntimeEvent[] = [];
		for await ( const e of handle ) {
			events.push( e );
		}

		expect( findAssistantText( events ) ).toBe( 'mocked openai response' );
		const final = events[ events.length - 1 ];
		expect( final.type ).toBe( 'turn_completed' );
		if ( final.type === 'turn_completed' ) {
			expect( final.subtype ).toBe( 'success' );
		}
	} );

	// `/model` swap mid-session must reach the next request — the prior cache
	// quietly served the old model.
	it( 'rebuilds the Agent when the model changes mid-session', async () => {
		constructedAgents.length = 0;
		const env = {
			OPENAI_API_KEY: 'sk-test',
			OPENAI_BASE_URL: 'https://proxy.example.com/v1',
		};
		const session = newSession();
		const otherOpenAiModel = 'gpt-test-other' as AiModelId;

		const first = piRuntime.run( { prompt: 'hi', env, model: 'gpt-5.5', session } );
		for await ( const _ of first );
		expect( constructedAgents ).toHaveLength( 1 );
		expect( constructedAgents[ 0 ].state.model.id ).toBe( 'gpt-5.5' );

		// `/model` swap — cache must NOT win.
		const second = piRuntime.run( {
			prompt: 'follow-up',
			env,
			model: otherOpenAiModel,
			session,
		} );
		for await ( const _ of second );
		expect( constructedAgents ).toHaveLength( 2 );
		expect( constructedAgents[ 1 ].state.model.id ).toBe( otherOpenAiModel );

		// Same model again — cache hits, no rebuild.
		const third = piRuntime.run( {
			prompt: 'still on the second model',
			env,
			model: otherOpenAiModel,
			session,
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
				session: newSession(),
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
