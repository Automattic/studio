import { SessionManager } from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runStudioAgentTurn, type StudioAgentTurnConfig } from 'cli/ai/runtimes/pi';
import type { AgentSessionEvent, CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent';
import type { AiModelId } from '@studio/common/ai/models';

const mocks = vi.hoisted( () => ( {
	createAgentSession: vi.fn(),
	createdSessions: [] as FakeSession[],
	nextEvents: null as AgentSessionEvent[] | null,
	studioRoot: '/tmp/studio-ai-pi-runtime',
	configRoot: '/tmp/studio-ai-pi-runtime-config',
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

vi.mock( '@earendil-works/pi-coding-agent', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@earendil-works/pi-coding-agent') >();
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

vi.mock( 'cli/lib/site-paths', () => ( {
	STUDIO_SITES_ROOT: mocks.studioRoot,
	getDefaultSitePath: ( siteName: string ) => `${ mocks.studioRoot }/${ siteName }`,
} ) );

vi.mock( '@studio/common/lib/well-known-paths', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/common/lib/well-known-paths') >();
	return {
		...actual,
		getConfigDirectory: () => mocks.configRoot,
		getAiPayloadsPath: () => `${ mocks.configRoot }/tmp/ai-payloads`,
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
	{ type: 'agent_end', willRetry: false, messages: [] },
];

type MessageEndEvent = Extract< AgentSessionEvent, { type: 'message_end' } >;

const assistantMessage = (
	content: unknown[],
	stopReason: 'stop' | 'length' = 'stop'
): MessageEndEvent =>
	( {
		type: 'message_end',
		message: {
			role: 'assistant',
			content,
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
			stopReason,
			timestamp: 0,
		},
	} ) as MessageEndEvent;

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

type RuntimeTool = {
	name: string;
	description: string;
	execute: (
		toolCallId: string,
		params: Record< string, unknown >
	) => Promise< { content: Array< { type: string; text: string } > } >;
};

function getCreatedTool( name: string ): RuntimeTool {
	const tools = ( mocks.createdSessions[ 0 ].options.customTools ??
		[] ) as unknown as RuntimeTool[];
	const tool = tools.find( ( item ) => item.name === name );
	expect( tool ).toBeTruthy();
	return tool!;
}

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

async function runRuntime(
	config: Omit< StudioAgentTurnConfig, 'onEvent' >
): Promise< AgentSessionEvent[] > {
	const events: AgentSessionEvent[] = [];
	const handle = runStudioAgentTurn( { ...config, onEvent: ( event ) => events.push( event ) } );
	await handle.result;
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

	it( 'emits agent_end carrying the credential error when OPENAI_API_KEY is absent', async () => {
		const events = await runRuntime( {
			prompt: 'hello',
			env: {},
			model: 'gpt-5.5',
			session: newSession(),
		} );

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

	it( 'emits a full exchange when AgentSession returns output', async () => {
		const events = await runRuntime( {
			prompt: 'hello',
			env: {
				OPENAI_API_KEY: 'sk-test',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( findAssistantText( events ) ).toBe( 'mocked openai response' );
		const final = events[ events.length - 1 ];
		expect( final.type ).toBe( 'agent_end' );
	} );

	it( 'advertises image input support so screenshot tool results can be analyzed', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: {
				OPENAI_API_KEY: 'sk-test',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( mocks.createdSessions[ 0 ].options.model?.input ).toEqual( [ 'text', 'image' ] );
	} );

	it( 'rejects oversized direct Write, Edit, and Bash payloads', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: {
				OPENAI_API_KEY: 'sk-test',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
			model: 'gpt-5.5',
			session: newSession(),
		} );

		const write = getCreatedTool( 'Write' );
		const edit = getCreatedTool( 'Edit' );
		const bash = getCreatedTool( 'Bash' );

		await expect(
			write.execute( 'write-call', {
				path: '/tmp/studio/site/tmp/large.txt',
				content: 'x'.repeat( 14 * 1024 + 1 ),
			} )
		).rejects.toThrow( /single-call safety limit/ );
		await expect(
			edit.execute( 'edit-call', {
				path: '/tmp/studio/site/tmp/large.txt',
				old_string: '<!-- anchor -->',
				new_string: 'x'.repeat( 14 * 1024 + 1 ),
			} )
		).rejects.toThrow( /single-call safety limit/ );
		await expect(
			bash.execute( 'bash-call', {
				command: 'x'.repeat( 8 * 1024 + 1 ),
			} )
		).rejects.toThrow( /single-call safety limit/ );
	} );

	it( 'rejects remote wpcom_request calls from length-truncated assistant messages', async () => {
		mocks.nextEvents = [
			assistantMessage(
				[
					{
						type: 'toolCall',
						id: 'wpcom-call-1',
						name: 'wpcom_request',
						arguments: {
							method: 'POST',
							path: '/pages/4',
							body: {
								content: '<!-- wp:paragraph --><p>partial',
							},
						},
						index: 0,
					},
				],
				'length'
			),
			{ type: 'agent_end', willRetry: false, messages: [] },
		] as AgentSessionEvent[];

		await runRuntime( {
			prompt: 'hello',
			env: {
				OPENAI_API_KEY: 'sk-test',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
			model: 'gpt-5.5',
			session: newSession(),
			activeSite: {
				name: 'Remote',
				path: '',
				running: false,
				remote: true,
				url: 'https://example.wordpress.com',
				wpcomSiteId: 123,
			},
			wpcomAccessToken: 'wpcom-token',
		} );

		const wpcomRequest = getCreatedTool( 'wpcom_request' );

		await expect(
			wpcomRequest.execute( 'wpcom-call-1', {
				method: 'POST',
				path: '/pages/4',
				body: { content: '<!-- wp:paragraph --><p>partial' },
			} )
		).rejects.toThrow( /hit the model output limit/ );
	} );

	it( 'leaves retry policy to pi settings defaults', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: {
				OPENAI_API_KEY: 'sk-test',
				OPENAI_BASE_URL: 'https://proxy.example.com/v1',
			},
			model: 'gpt-5.5',
			session: newSession(),
		} );

		expect( mocks.createdSessions[ 0 ].options.settingsManager?.getRetrySettings() ).toMatchObject(
			{
				enabled: true,
				maxRetries: 3,
				baseDelayMs: 2000,
			}
		);
	} );

	it( 'creates each AgentSession with the requested model', async () => {
		const env = {
			OPENAI_API_KEY: 'sk-test',
			OPENAI_BASE_URL: 'https://proxy.example.com/v1',
		};
		const session = newSession();
		const otherOpenAiModel = 'gpt-test-other' as AiModelId;

		await runRuntime( { prompt: 'hi', env, model: 'gpt-5.5', session } );
		await runRuntime( { prompt: 'follow-up', env, model: otherOpenAiModel, session } );
		await runRuntime( {
			prompt: 'still on the second model',
			env,
			model: otherOpenAiModel,
			session,
		} );

		expect( mocks.createdSessions.map( ( s ) => s.state.model.id ) ).toEqual( [
			'gpt-5.5',
			otherOpenAiModel,
			otherOpenAiModel,
		] );
	} );

	it( 'registers WPCOM Anthropic as a custom bearer-auth provider', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: {
				ANTHROPIC_AUTH_TOKEN: 'wpcom-token',
				ANTHROPIC_BASE_URL: 'https://proxy.example.com',
				ANTHROPIC_CUSTOM_HEADERS:
					'X-WPCOM-AI-Feature: studio-assistant-anthropic\nX-WPCOM-Session-ID: session-1',
			},
			model: 'claude-sonnet-5',
			session: newSession(),
		} );

		const options = mocks.createdSessions[ 0 ].options;
		expect( options.model?.provider ).toBe( 'studio-wpcom-anthropic' );
		expect( options.model?.api ).toBe( 'anthropic-messages' );
		expect( options.model?.maxTokens ).toBe( 32_000 );
		expect( options.model?.input ).toEqual( [ 'text', 'image' ] );
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

	// pi parses registerProvider config values as templates, so a wpcom token
	// containing `$name` would be read as an undefined env-var reference and the
	// provider would look unauthenticated ("No API key found"). The token must be
	// escaped so pi resolves it back to the literal value.
	it( 'keeps the wpcom token configured when it contains template metacharacters', async () => {
		const tokenWithDollar = 'abc$t5CmlMyb$VRe7t1xyz';

		await runRuntime( {
			prompt: 'hello',
			env: {
				ANTHROPIC_AUTH_TOKEN: tokenWithDollar,
				ANTHROPIC_BASE_URL: 'https://proxy.example.com',
				ANTHROPIC_CUSTOM_HEADERS: 'X-WPCOM-AI-Feature: studio-assistant-anthropic',
			},
			model: 'claude-sonnet-5',
			session: newSession(),
		} );

		const options = mocks.createdSessions[ 0 ].options;
		expect( options.modelRegistry!.hasConfiguredAuth( options.model! ) ).toBe( true );
		const auth = await options.modelRegistry!.getApiKeyAndHeaders( options.model! );
		expect( auth ).toMatchObject( { ok: true, apiKey: tokenWithDollar } );
	} );

	// Silent header-drop would surface as an opaque 401 from the wpcom proxy.
	it( 'warns and continues when STUDIO_OPENAI_DEFAULT_HEADERS is malformed', async () => {
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		try {
			await runRuntime( {
				prompt: 'hello',
				env: {
					OPENAI_API_KEY: 'sk-test',
					OPENAI_BASE_URL: 'https://proxy.example.com/v1',
					STUDIO_OPENAI_DEFAULT_HEADERS: '{not json',
				},
				model: 'gpt-5.5',
				session: newSession(),
			} );

			expect( warnSpy ).toHaveBeenCalledTimes( 1 );
			expect( warnSpy.mock.calls[ 0 ][ 0 ] ).toMatch(
				/STUDIO_OPENAI_DEFAULT_HEADERS.*malformed JSON/
			);
		} finally {
			warnSpy.mockRestore();
		}
	} );
} );
