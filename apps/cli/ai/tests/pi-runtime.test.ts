import { SessionManager } from '@mariozechner/pi-coding-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAgentForSession, piRuntime } from 'cli/ai/runtimes/pi';
import type { AgentSessionEvent, CreateAgentSessionOptions } from '@mariozechner/pi-coding-agent';
import type { AiModelId } from '@studio/common/ai/models';

const mocks = vi.hoisted( () => ( {
	createAgentSession: vi.fn(),
	createdSessions: [] as FakeSession[],
	nextEvents: null as AgentSessionEvent[] | null,
} ) );

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
		createAgentSession: mocks.createAgentSession,
		createReadTool: () => stub( 'Read' ),
		createWriteTool: () => stub( 'Write' ),
		createEditTool: () => stub( 'Edit' ),
		createBashTool: () => stub( 'Bash' ),
		createGrepTool: () => stub( 'Grep' ),
		createFindTool: () => stub( 'Glob' ),
		createLsTool: () => stub( 'Ls' ),
	};
} );

const DEFAULT_MOCK_EVENTS: AgentSessionEvent[] = [
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

class FakeSession {
	private listener?: ( event: AgentSessionEvent ) => void;
	public state: { model: { id: string; provider: string }; messages: unknown[] };
	public aborted = false;
	public disposed = false;

	constructor( public options: CreateAgentSessionOptions ) {
		this.state = {
			model: {
				id: options.model?.id ?? '',
				provider: options.model?.provider ?? '',
			},
			messages: options.sessionManager?.buildSessionContext().messages.slice() ?? [],
		};
	}

	subscribe( listener: ( event: AgentSessionEvent ) => void ): () => void {
		this.listener = listener;
		return () => {};
	}

	async prompt( _text: string ): Promise< void > {
		const events = mocks.nextEvents ?? DEFAULT_MOCK_EVENTS;
		mocks.nextEvents = null;
		for ( const event of events ) {
			this.listener?.( event );
		}
	}

	async abort(): Promise< void > {
		this.aborted = true;
	}

	dispose(): void {
		this.disposed = true;
	}
}

const newSession = () => SessionManager.inMemory( '/tmp/eval' );

const findAssistantText = ( events: AgentSessionEvent[] ): string | undefined => {
	for ( const e of events ) {
		if ( e.type === 'message_end' && e.message.role === 'assistant' ) {
			for ( const block of e.message.content ) {
				if ( block.type === 'text' ) return block.text;
			}
		}
	}
	return undefined;
};

async function drain( handle: AsyncIterable< AgentSessionEvent > ): Promise< AgentSessionEvent[] > {
	const events: AgentSessionEvent[] = [];
	for await ( const event of handle ) {
		events.push( event );
	}
	return events;
}

describe( 'pi runtime', () => {
	beforeEach( () => {
		mocks.createdSessions.length = 0;
		mocks.nextEvents = null;
		mocks.createAgentSession.mockReset();
		mocks.createAgentSession.mockImplementation( async ( options: CreateAgentSessionOptions ) => {
			const session = new FakeSession( options );
			mocks.createdSessions.push( session );
			return { session, extensionsResult: { extensions: [], errors: [], runtime: {} } };
		} );
	} );

	it( 'yields agent_end carrying the credential error when OPENAI_API_KEY is absent', async () => {
		const events = await drain(
			piRuntime.run( {
				prompt: 'hello',
				env: {},
				model: 'gpt-5.5',
				session: newSession(),
			} )
		);

		expect( mocks.createAgentSession ).not.toHaveBeenCalled();
		expect( events ).toHaveLength( 1 );
		const final = events[ 0 ];
		expect( final.type ).toBe( 'agent_end' );
		if ( final.type === 'agent_end' ) {
			const last = final.messages[ final.messages.length - 1 ];
			expect( last.role ).toBe( 'assistant' );
			if ( last.role === 'assistant' ) {
				expect( last.stopReason ).toBe( 'error' );
				expect( last.errorMessage ).toMatch( /OPENAI_API_KEY/ );
			}
		}
	} );

	it( 'yields a full exchange when AgentSession returns output', async () => {
		const events = await drain(
			piRuntime.run( {
				prompt: 'hello',
				env: {
					OPENAI_API_KEY: 'sk-test',
					OPENAI_BASE_URL: 'https://proxy.example.com/v1',
				},
				model: 'gpt-5.5',
				session: newSession(),
			} )
		);

		expect( findAssistantText( events ) ).toBe( 'mocked openai response' );
		const final = events[ events.length - 1 ];
		expect( final.type ).toBe( 'agent_end' );
	} );

	it( 'creates each AgentSession with the requested model', async () => {
		const env = {
			OPENAI_API_KEY: 'sk-test',
			OPENAI_BASE_URL: 'https://proxy.example.com/v1',
		};
		const session = newSession();
		const otherOpenAiModel = 'gpt-test-other' as AiModelId;

		await drain( piRuntime.run( { prompt: 'hi', env, model: 'gpt-5.5', session } ) );
		await drain( piRuntime.run( { prompt: 'follow-up', env, model: otherOpenAiModel, session } ) );
		await drain(
			piRuntime.run( {
				prompt: 'still on the second model',
				env,
				model: otherOpenAiModel,
				session,
			} )
		);

		expect( mocks.createdSessions.map( ( s ) => s.state.model.id ) ).toEqual( [
			'gpt-5.5',
			otherOpenAiModel,
			otherOpenAiModel,
		] );
	} );

	it( 'drops pre-`session_cleared` messages from the AgentSession context', async () => {
		const env = {
			OPENAI_API_KEY: 'sk-test',
			OPENAI_BASE_URL: 'https://proxy.example.com/v1',
		};
		const session = SessionManager.inMemory( '/tmp/eval' );

		session.appendMessage( { role: 'user', content: 'pre-clear question', timestamp: 1 } );
		session.appendMessage( {
			role: 'assistant',
			content: [ { type: 'text', text: 'pre-clear answer' } ],
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
			timestamp: 2,
		} );
		session.appendCustomEntry( 'studio.session_cleared', {} );
		clearAgentForSession( session.getSessionId() );

		await drain( piRuntime.run( { prompt: 'after clear', env, model: 'gpt-5.5', session } ) );

		expect( mocks.createdSessions ).toHaveLength( 1 );
		const flat = JSON.stringify( mocks.createdSessions[ 0 ].state.messages );
		expect( flat ).not.toContain( 'pre-clear question' );
		expect( flat ).not.toContain( 'pre-clear answer' );
	} );

	it( 'registers WPCOM Anthropic as a custom bearer-auth provider', async () => {
		await drain(
			piRuntime.run( {
				prompt: 'hello',
				env: {
					ANTHROPIC_AUTH_TOKEN: 'wpcom-token',
					ANTHROPIC_BASE_URL: 'https://proxy.example.com',
					ANTHROPIC_CUSTOM_HEADERS:
						'X-WPCOM-AI-Feature: studio-assistant-anthropic\nX-WPCOM-Session-ID: session-1',
				},
				model: 'claude-sonnet-4-6',
				session: newSession(),
			} )
		);

		const options = mocks.createdSessions[ 0 ].options;
		expect( options.model?.provider ).toBe( 'studio-wpcom-anthropic' );
		expect( options.model?.api ).toBe( 'anthropic-messages' );
		const auth = await options.modelRegistry!.getApiKeyAndHeaders( options.model! );
		expect( auth ).toMatchObject( {
			ok: true,
			apiKey: 'wpcom-token',
			headers: {
				'X-WPCOM-AI-Feature': 'studio-assistant-anthropic',
				'X-WPCOM-Session-ID': 'session-1',
			},
		} );
	} );

	// Silent header-drop would surface as an opaque 401 from the wpcom proxy.
	it( 'warns and continues when STUDIO_OPENAI_DEFAULT_HEADERS is malformed', async () => {
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		try {
			await drain(
				piRuntime.run( {
					prompt: 'hello',
					env: {
						OPENAI_API_KEY: 'sk-test',
						OPENAI_BASE_URL: 'https://proxy.example.com/v1',
						STUDIO_OPENAI_DEFAULT_HEADERS: '{not json',
					},
					model: 'gpt-5.5',
					session: newSession(),
				} )
			);

			expect( warnSpy ).toHaveBeenCalledTimes( 1 );
			expect( warnSpy.mock.calls[ 0 ][ 0 ] ).toMatch(
				/STUDIO_OPENAI_DEFAULT_HEADERS.*malformed JSON/
			);
		} finally {
			warnSpy.mockRestore();
		}
	} );
} );
