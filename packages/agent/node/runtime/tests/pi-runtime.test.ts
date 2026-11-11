import { ModelRegistry, SessionManager } from '@earendil-works/pi-coding-agent';
import { getAiModelProviders } from '@studio/providers';
import { getProvider } from '@studio/providers/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from '@studio/agent/node/agent';
import { createFakeHost } from '../../tests/fake-host';
import type { AgentSessionEvent, CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent';
import type { StudioAgentTurnConfig } from '@studio/agent/node/runtime';
import type { AiModelId } from '@studio/providers';

const mocks = vi.hoisted( () => ( {
	createAgentSession: vi.fn(),
	createdSessions: [] as FakeSession[],
	nextEvents: null as AgentSessionEvent[] | null,
	continueEvents: [] as AgentSessionEvent[][],
	customMessages: [] as Array< { message: unknown; options: unknown } >,
	onCustomMessage: null as ( () => void ) | null,
	studioRoot: '/tmp/studio-ai-pi-runtime',
	configRoot: '/tmp/studio-ai-pi-runtime-config',
} ) );

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

const agent = createAgent( { host: createFakeHost( mocks.studioRoot ) } );

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
			content: [ { type: 'text', text: 'mocked wpcom response' } ],
			api: 'openai-completions',
			provider: 'studio-wpcom',
			model: 'balanced',
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
			content: [ { type: 'text', text: 'mocked wpcom response' } ],
			api: 'openai-completions',
			provider: 'studio-wpcom',
			model: 'balanced',
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
			provider: 'studio-wpcom',
			model: 'balanced',
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

	async sendCustomMessage( message: unknown, options: unknown ): Promise< void > {
		mocks.customMessages.push( { message, options } );
		mocks.onCustomMessage?.();
		for ( const event of mocks.continueEvents.shift() ?? [] ) {
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

// Connects through the provider serving `model`, as the CLI does.
async function connect( model: AiModelId, token = 'wpcom-token' ) {
	const context = { userAgent: 'Studio/test' };
	return getAiModelProviders( model )[ 0 ] === 'wpcom'
		? getProvider( 'wpcom' ).ai!.connect( { ...context, config: { token } }, model, {} )
		: getProvider( 'anthropic' ).ai!.connect(
				{ ...context, config: { method: 'api-key', apiKey: 'sk-ant-test' } },
				model,
				{}
		  );
}

type RuntimeConfig = Omit< StudioAgentTurnConfig, 'onEvent' | 'ai' > & {
	model: AiModelId;
	token?: string;
};

async function runRuntime( {
	model,
	token,
	...config
}: RuntimeConfig ): Promise< AgentSessionEvent[] > {
	const events: AgentSessionEvent[] = [];
	const ai = await connect( model, token );
	const handle = agent.runTurn( { ...config, ai, onEvent: ( event ) => events.push( event ) } );
	await handle.result;
	return events;
}

describe( 'pi runtime', () => {
	beforeEach( () => {
		vi.unstubAllEnvs();
		vi.stubEnv( 'WPCOM_AI_PROXY_BASE_URL', 'https://proxy.example.com' );
		mocks.createdSessions.length = 0;
		mocks.nextEvents = null;
		mocks.continueEvents = [];
		mocks.customMessages = [];
		mocks.onCustomMessage = null;
		mocks.createAgentSession.mockReset();
		mocks.createAgentSession.mockImplementation( async ( options: CreateAgentSessionOptions ) => {
			const session = new FakeSession( options );
			mocks.createdSessions.push( session );
			return { session, extensionsResult: { extensions: [], errors: [], runtime: {} } };
		} );
	} );

	it( 'registers the connection with pi under its provider', async () => {
		await runRuntime( { prompt: 'hello', model: 'fast', session: newSession() } );

		const options = mocks.createdSessions[ 0 ].options;
		expect( options.model?.id ).toBe( 'fast' );
		expect( options.model?.provider ).toBe( 'studio-wpcom' );
		expect( options.model?.api ).toBe( 'openai-completions' );
		const modelRegistry = new ModelRegistry( options.modelRuntime! );
		const auth = await modelRegistry.getApiKeyAndHeaders( options.model! );
		expect( auth ).toMatchObject( {
			ok: true,
			apiKey: 'wpcom-token',
			headers: { 'X-WPCOM-AI-Feature': 'studio-agent' },
		} );
	} );

	it.each( [
		[ 'balanced', 'https://proxy.example.com/v1/responses', 'balanced-2' ],
		[ 'strong', 'https://proxy.example.com/v1/messages?beta=true', 'strong-2' ],
	] as const )(
		'sends the %s tier to the proxy under its API model name',
		async ( model, expectedUrl, expectedModel ) => {
			await runRuntime( { prompt: 'hello', model, session: newSession() } );
			const options = mocks.createdSessions[ 0 ].options;
			const fetchSpy = vi
				.spyOn( globalThis, 'fetch' )
				.mockResolvedValue( new Response( '{}', { status: 400 } ) );

			let request: Parameters< typeof fetch > | undefined;
			try {
				await options
					.modelRuntime!.streamSimple(
						options.model!,
						{ messages: [ { role: 'user', content: 'hi', timestamp: 0 } ] },
						{ maxRetries: 0 }
					)
					.result();
				request = fetchSpy.mock.calls[ 0 ];
			} finally {
				fetchSpy.mockRestore();
			}

			const [ url, init ] = request!;
			expect( String( url ) ).toBe( expectedUrl );
			expect( JSON.parse( String( init?.body ) ).model ).toBe( expectedModel );
			expect( new Headers( init?.headers ).get( 'authorization' ) ).toBe( 'Bearer wpcom-token' );
			expect( options.model!.id ).toBe( model );
		}
	);

	it.each( [ 'fast', 'balanced', 'strong' ] as const )(
		'surfaces the proxy cost cap on the %s tier as a usage-cap error',
		async ( model ) => {
			await runRuntime( { prompt: 'hello', model, session: newSession() } );
			const options = mocks.createdSessions[ 0 ].options;
			const body = JSON.stringify( {
				error: { code: 'cost_cap_exceeded', message: 'Monthly cost cap exceeded.' },
			} );
			const fetchSpy = vi
				.spyOn( globalThis, 'fetch' )
				.mockImplementation( async () => new Response( body, { status: 429 } ) );

			try {
				const result = await options
					.modelRuntime!.streamSimple(
						options.model!,
						{ messages: [ { role: 'user', content: 'hi', timestamp: 0 } ] },
						{ maxRetries: 0 }
					)
					.result();
				expect( result.errorMessage ).toMatch( /^Monthly usage limit reached: / );
			} finally {
				fetchSpy.mockRestore();
			}
		}
	);

	it( 'advertises image input per model rather than per family', async () => {
		await runRuntime( {
			prompt: 'hello',
			model: 'balanced',
			session: newSession(),
		} );
		await runRuntime( {
			prompt: 'hello',
			model: 'fast',
			session: newSession(),
		} );

		expect( mocks.createdSessions[ 0 ].options.model?.input ).toEqual( [ 'text', 'image' ] );
		expect( mocks.createdSessions[ 1 ].options.model?.input ).toEqual( [ 'text' ] );
	} );

	it( 'keeps take_screenshot for models that cannot see images, without the image', async () => {
		await runRuntime( {
			prompt: 'hello',
			model: 'balanced',
			session: newSession(),
		} );
		await runRuntime( {
			prompt: 'hello',
			model: 'fast',
			session: newSession(),
		} );

		const takeScreenshot = ( index: number ) =>
			(
				( mocks.createdSessions[ index ].options.customTools ?? [] ) as {
					name: string;
					description: string;
				}[]
			 ).find( ( tool ) => tool.name === 'take_screenshot' );
		expect( takeScreenshot( 0 )?.description ).toContain( 'analyze visually' );
		expect( takeScreenshot( 1 )?.description ).toContain( 'This model cannot view images' );
		expect( takeScreenshot( 1 )?.description ).not.toContain( 'analyze visually' );
	} );

	it( 'rejects oversized direct Write, Edit, and Bash payloads', async () => {
		await runRuntime( {
			prompt: 'hello',
			model: 'balanced',
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
				edits: [ { oldText: '<!-- anchor -->', newText: 'x'.repeat( 14 * 1024 + 1 ) } ],
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
			model: 'balanced',
			session: newSession(),
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

	describe( 'a reply with neither text nor a tool call', () => {
		const emptyReply = () => assistantMessage( [ { type: 'thinking', thinking: 'reasoning…' } ] );
		const runEndingWith = ( message: MessageEndEvent ): AgentSessionEvent[] => [
			message,
			{ type: 'agent_end', willRetry: false, messages: [ message.message ] },
		];
		const agentEnds = ( events: AgentSessionEvent[] ) =>
			events.filter(
				( event ): event is Extract< AgentSessionEvent, { type: 'agent_end' } > =>
					event.type === 'agent_end'
			);
		const runFast = () =>
			runRuntime( { prompt: 'build it', model: 'fast', session: newSession() } );

		it( 'continues the turn with a message the user does not see', async () => {
			mocks.nextEvents = runEndingWith( emptyReply() );
			mocks.continueEvents = [
				runEndingWith( assistantMessage( [ { type: 'text', text: 'Done.' } ] ) ),
			];

			const events = await runFast();

			expect( mocks.customMessages ).toEqual( [
				{
					message: {
						customType: 'studio.empty_stop_continue',
						content:
							'Your reasoning was cut off before you replied. Continue from where it stopped:\n\nreasoning…',
						display: false,
					},
					options: { triggerTurn: true },
				},
			] );
			expect( agentEnds( events ).map( ( event ) => event.willRetry ) ).toEqual( [ true, false ] );
			expect( findAssistantText( events ) ).toBe( 'Done.' );
		} );

		it( 'ends the turn after two continues', async () => {
			mocks.nextEvents = runEndingWith( emptyReply() );
			mocks.continueEvents = [ runEndingWith( emptyReply() ), runEndingWith( emptyReply() ) ];

			const events = await runFast();

			expect( mocks.customMessages ).toHaveLength( 2 );
			expect( agentEnds( events ).map( ( event ) => event.willRetry ) ).toEqual( [
				true,
				true,
				false,
			] );
		} );

		it( 'leaves a reply with text or a tool call alone', async () => {
			for ( const content of [
				[ { type: 'text', text: 'Which colours do you like?' } ],
				[ { type: 'toolCall', id: 'call-1', name: 'site_info', arguments: {} } ],
			] ) {
				mocks.nextEvents = runEndingWith( assistantMessage( content ) );
				const events = await runFast();
				expect( agentEnds( events ).map( ( event ) => event.willRetry ) ).toEqual( [ false ] );
			}
			expect( mocks.customMessages ).toHaveLength( 0 );
		} );

		it( 'ends the turn as interrupted when the user stops it first', async () => {
			mocks.nextEvents = runEndingWith( emptyReply() );
			const events: AgentSessionEvent[] = [];
			const ai = await connect( 'fast' );
			const handle = agent.runTurn( {
				prompt: 'build it',
				ai,
				session: newSession(),
				onEvent: ( event ) => {
					events.push( event );
					if ( event.type === 'agent_end' && event.willRetry ) {
						void handle.interrupt();
					}
				},
			} );
			await handle.result;

			expect( mocks.customMessages ).toHaveLength( 0 );
			const ends = agentEnds( events );
			expect( ends.map( ( event ) => event.willRetry ) ).toEqual( [ true, false ] );
			expect( ends[ 1 ].messages[ 0 ] ).toMatchObject( { stopReason: 'aborted' } );
		} );
	} );

	it( 'creates each AgentSession with the requested model', async () => {
		const session = newSession();
		const otherStudioModel = 'fast';

		await runRuntime( { prompt: 'hi', model: 'balanced', session } );
		await runRuntime( { prompt: 'follow-up', model: otherStudioModel, session } );
		await runRuntime( {
			prompt: 'still on the second model',
			model: otherStudioModel,
			session,
		} );

		expect( mocks.createdSessions.map( ( s ) => s.state.model.id ) ).toEqual( [
			'balanced',
			otherStudioModel,
			otherStudioModel,
		] );
	} );

	// The registered key wins over pi's own environment lookup, so the CLI
	// no longer scrubs ANTHROPIC_API_KEY before a turn.
	it( 'runs Anthropic models on the connection key, not the environment', async () => {
		vi.stubEnv( 'ANTHROPIC_API_KEY', 'sk-ant-from-env' );
		await runRuntime( { prompt: 'hello', model: 'claude-sonnet-5', session: newSession() } );

		const options = mocks.createdSessions[ 0 ].options;
		expect( options.model?.provider ).toBe( 'anthropic' );
		const auth = await new ModelRegistry( options.modelRuntime! ).getApiKeyAndHeaders(
			options.model!
		);
		expect( auth ).toMatchObject( { ok: true, apiKey: 'sk-ant-test' } );
	} );

	// pi parses registerProvider config values as templates, so a wpcom token
	// containing `$name` would be read as an undefined env-var reference and the
	// provider would look unauthenticated ("No API key found"). The token must be
	// escaped so pi resolves it back to the literal value.
	it( 'keeps the wpcom token configured when it contains template metacharacters', async () => {
		const tokenWithDollar = 'abc$t5CmlMyb$VRe7t1xyz';

		await runRuntime( {
			prompt: 'hello',
			token: tokenWithDollar,
			model: 'balanced',
			session: newSession(),
		} );

		const options = mocks.createdSessions[ 0 ].options;
		const modelRegistry = new ModelRegistry( options.modelRuntime! );
		expect( modelRegistry.hasConfiguredAuth( options.model! ) ).toBe( true );
		const auth = await modelRegistry.getApiKeyAndHeaders( options.model! );
		expect( auth ).toMatchObject( { ok: true, apiKey: tokenWithDollar } );
	} );
} );
