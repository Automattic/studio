import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
import { ModelRegistry, SessionManager } from '@earendil-works/pi-coding-agent';
import { AI_MODELS } from '@studio/common/ai/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runStudioAgentTurn, type StudioAgentTurnConfig } from 'cli/ai/runtimes/pi';
import type { AgentSessionEvent, CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent';
import type { AiModelId } from '@studio/common/ai/models';

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

// Model-swap test uses a synthetic id outside `AI_MODELS`; route unknowns to
// 'studio' so the env credentials match.
vi.mock( '@studio/common/ai/models', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/common/ai/models') >();
	return {
		...actual,
		getAiModelFamily: ( id: string ) =>
			actual.isAiModelId( id ) ? actual.getAiModelFamily( id ) : 'studio',
		getAiModel: ( id: string ) =>
			actual.isAiModelId( id ) ? actual.getAiModel( id ) : { id, label: id, family: 'studio' },
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
	public activeToolNames: string[] = [];

	constructor( public options: CreateAgentSessionOptions ) {
		this.state = {
			model: {
				id: options.model?.id ?? '',
				provider: options.model?.provider ?? '',
			},
			messages: options.sessionManager?.buildSessionContext().messages.slice() ?? [],
		};
	}

	setActiveToolsByName( names: string[] ): void {
		this.activeToolNames = names;
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

async function runRuntime(
	config: Omit< StudioAgentTurnConfig, 'onEvent' >
): Promise< AgentSessionEvent[] > {
	const events: AgentSessionEvent[] = [];
	const handle = runStudioAgentTurn( { ...config, onEvent: ( event ) => events.push( event ) } );
	await handle.result;
	return events;
}

const WPCOM_ENV = {
	STUDIO_WPCOM_API_KEY: 'wpcom-token',
	STUDIO_WPCOM_BASE_URL: 'https://proxy.example.com/v1',
};

describe( 'pi runtime', () => {
	beforeEach( () => {
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

	it( 'emits agent_end carrying the credential error when STUDIO_WPCOM_API_KEY is absent', async () => {
		const events = await runRuntime( {
			prompt: 'hello',
			env: {},
			model: 'balanced',
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
				expect( last.errorMessage ).toMatch( /STUDIO_WPCOM_API_KEY/ );
			}
		}
	} );

	it( 'activates the tools a skill brings once the skill is loaded', async () => {
		await runRuntime( { prompt: 'hello', session: newSession(), env: WPCOM_ENV } );
		const session = mocks.createdSessions[ 0 ] as unknown as FakeSession;
		expect( session.activeToolNames ).toContain( 'Bash' );
		expect( session.activeToolNames ).not.toContain( 'wp_cli' );
		expect( session.activeToolNames ).not.toContain( 'install_taxonomy_scripts' );
		await getCreatedTool( 'Skill' ).execute( 't', { name: 'taxonomist' } );
		expect( session.activeToolNames ).toContain( 'install_taxonomy_scripts' );
	} );

	it( 'emits a full exchange when AgentSession returns output', async () => {
		const events = await runRuntime( {
			prompt: 'hello',
			env: WPCOM_ENV,
			model: 'balanced',
			session: newSession(),
		} );

		expect( findAssistantText( events ) ).toBe( 'mocked wpcom response' );
		const final = events[ events.length - 1 ];
		expect( final.type ).toBe( 'agent_end' );
	} );

	it( 'routes the fast tier to the wpcom Chat Completions path', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: {
				...WPCOM_ENV,
				STUDIO_WPCOM_DEFAULT_HEADERS: JSON.stringify( {
					'X-WPCOM-AI-Feature': 'studio-agent',
					'X-WPCOM-Session-ID': 'session-2',
				} ),
			},
			model: 'fast',
			session: newSession(),
		} );

		const options = mocks.createdSessions[ 0 ].options;
		expect( options.model?.id ).toBe( 'fast' );
		expect( options.model?.provider ).toBe( 'studio-wpcom' );
		expect( options.model?.api ).toBe( 'openai-completions' );
		const modelRegistry = new ModelRegistry( options.modelRuntime! );
		const auth = await modelRegistry.getApiKeyAndHeaders( options.model! );
		expect( auth ).toMatchObject( {
			ok: true,
			apiKey: 'wpcom-token',
			headers: {
				'X-WPCOM-AI-Feature': 'studio-agent',
				'X-WPCOM-Session-ID': 'session-2',
			},
		} );
	} );

	// Without these the request carries OpenAI-only fields other upstreams
	// reject: pi infers them from the base URL, which for us reads as OpenAI.
	it( 'declares compat overrides the proxy URL cannot be detected from', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: WPCOM_ENV,
			model: 'fast',
			session: newSession(),
		} );

		expect( mocks.createdSessions[ 0 ].options.model?.compat ).toMatchObject( {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsStrictMode: false,
			maxTokensField: 'max_tokens',
		} );
	} );

	// `balanced` resolves to a reasoning model that rejects the Chat Completions
	// dialect's tools-plus-reasoning combination, so it rides the Responses
	// path — the plain OpenAI dialect, with no compat overrides.
	it( 'routes the balanced tier to the wpcom Responses path', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: WPCOM_ENV,
			model: 'balanced',
			session: newSession(),
		} );

		const model = mocks.createdSessions[ 0 ].options.model!;
		expect( model.api ).toBe( 'openai-responses' );
		expect( model.provider ).toBe( 'studio-wpcom' );
		expect( model.compat ).toBeUndefined();
	} );

	it.each( [
		[ 'balanced', 'https://proxy.example.com/v1/responses', 'balanced-2' ],
		[ 'strong', 'https://proxy.example.com/v1/messages', 'strong-2' ],
	] as const )(
		'sends the %s tier to the proxy under its API model name',
		async ( model, expectedUrl, expectedModel ) => {
			await runRuntime( { prompt: 'hello', env: WPCOM_ENV, model, session: newSession() } );
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
			await runRuntime( { prompt: 'hello', env: WPCOM_ENV, model, session: newSession() } );
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
			env: WPCOM_ENV,
			model: 'balanced',
			session: newSession(),
		} );
		await runRuntime( {
			prompt: 'hello',
			env: WPCOM_ENV,
			model: 'fast',
			session: newSession(),
		} );

		expect( mocks.createdSessions[ 0 ].options.model?.input ).toEqual( [ 'text', 'image' ] );
		expect( mocks.createdSessions[ 1 ].options.model?.input ).toEqual( [ 'text' ] );
	} );

	it( 'keeps take_screenshot for models that cannot see images, without the image', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: WPCOM_ENV,
			model: 'balanced',
			session: newSession(),
		} );
		await runRuntime( {
			prompt: 'hello',
			env: WPCOM_ENV,
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

	it( 'asks the user before a destructive call runs, and does not run it when declined', async () => {
		const onAskUser = vi.fn().mockResolvedValue( { 'Delete the site "nope"?': 'No' } );
		await runRuntime( { prompt: 'hello', session: newSession(), env: WPCOM_ENV, onAskUser } );
		await expect(
			getCreatedTool( 'site_delete' ).execute( 't', { nameOrPath: 'nope' } )
		).rejects.toThrow( 'Not run: the user answered "No" to: Delete the site "nope"?' );
		expect( onAskUser ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'rejects oversized direct Write, Edit, and Bash payloads', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: WPCOM_ENV,
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

	it( 'rejects tool calls from length-truncated assistant messages', async () => {
		mocks.nextEvents = [
			assistantMessage(
				[
					{
						type: 'toolCall',
						id: 'bash-call-1',
						name: 'Bash',
						arguments: {
							command: 'wp post update 4 --post_content="<!-- wp:paragraph --><p>partial',
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
			env: WPCOM_ENV,
			model: 'balanced',
			session: newSession(),
		} );

		await expect(
			getCreatedTool( 'Bash' ).execute( 'bash-call-1', {
				command: 'wp post update 4 --post_content="<!-- wp:paragraph --><p>partial',
			} )
		).rejects.toThrow( /hit the model output limit/ );
	} );

	it( 'leaves retry policy to pi settings defaults', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: WPCOM_ENV,
			model: 'balanced',
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
			runRuntime( { prompt: 'build it', env: WPCOM_ENV, model: 'fast', session: newSession() } );

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
			const handle = runStudioAgentTurn( {
				prompt: 'build it',
				env: WPCOM_ENV,
				model: 'fast',
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
		const otherStudioModel = 'tier-test-other' as AiModelId;

		await runRuntime( { prompt: 'hi', env: WPCOM_ENV, model: 'balanced', session } );
		await runRuntime( { prompt: 'follow-up', env: WPCOM_ENV, model: otherStudioModel, session } );
		await runRuntime( {
			prompt: 'still on the second model',
			env: WPCOM_ENV,
			model: otherStudioModel,
			session,
		} );

		expect( mocks.createdSessions.map( ( s ) => s.state.model.id ) ).toEqual( [
			'balanced',
			otherStudioModel,
			otherStudioModel,
		] );
	} );

	// Without `compat.forceAdaptiveThinking`, pi-ai sends a thinking shape that
	// Sonnet 5 / Opus 5 reject with a 400.
	it( 'marks direct-key Anthropic models as adaptive-thinking', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
			model: 'claude-sonnet-5',
			session: newSession(),
		} );

		const model = mocks.createdSessions[ 0 ].options.model!;
		expect( model.provider ).toBe( 'anthropic' );
		expect( model.compat ).toMatchObject( { forceAdaptiveThinking: true } );
		expect( model.thinkingLevelMap ).toEqual( { xhigh: 'xhigh', max: 'max' } );
		// Studio's conservative limits are intentionally not taken from pi's catalog.
		expect( model.maxTokens ).toBe( 32_000 );
		expect( model.contextWindow ).toBe( 200_000 );
	} );

	it( 'copies per-model compat from the pi catalog', async () => {
		await runRuntime( {
			prompt: 'hello',
			env: { ANTHROPIC_API_KEY: 'sk-ant-test' },
			model: 'claude-opus-5',
			session: newSession(),
		} );

		const model = mocks.createdSessions[ 0 ].options.model!;
		expect( model.compat ).toMatchObject( {
			forceAdaptiveThinking: true,
			supportsTemperature: false,
		} );
	} );

	// A Studio model missing from the pinned pi-ai catalog would silently fall
	// back to the rejected thinking shape.
	it( 'has a pi catalog entry with adaptive-thinking compat for every Anthropic model', () => {
		const anthropicIds = AI_MODELS.filter( ( m ) => m.family === 'anthropic' ).map( ( m ) => m.id );
		expect( anthropicIds.length ).toBeGreaterThan( 0 );
		for ( const id of anthropicIds ) {
			const catalogModel = ( ANTHROPIC_MODELS as Record< string, { compat?: object } > )[ id ];
			expect( catalogModel, `missing pi catalog entry for ${ id }` ).toBeDefined();
			expect( catalogModel.compat, `missing compat for ${ id }` ).toMatchObject( {
				forceAdaptiveThinking: true,
			} );
		}
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
				STUDIO_WPCOM_API_KEY: tokenWithDollar,
				STUDIO_WPCOM_BASE_URL: 'https://proxy.example.com/v1',
			},
			model: 'balanced',
			session: newSession(),
		} );

		const options = mocks.createdSessions[ 0 ].options;
		const modelRegistry = new ModelRegistry( options.modelRuntime! );
		expect( modelRegistry.hasConfiguredAuth( options.model! ) ).toBe( true );
		const auth = await modelRegistry.getApiKeyAndHeaders( options.model! );
		expect( auth ).toMatchObject( { ok: true, apiKey: tokenWithDollar } );
	} );

	// Silent header-drop would surface as an opaque 401 from the wpcom proxy.
	it( 'warns and continues when STUDIO_WPCOM_DEFAULT_HEADERS is malformed', async () => {
		const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

		try {
			await runRuntime( {
				prompt: 'hello',
				env: {
					...WPCOM_ENV,
					STUDIO_WPCOM_DEFAULT_HEADERS: '{not json',
				},
				model: 'balanced',
				session: newSession(),
			} );

			expect( warnSpy ).toHaveBeenCalledTimes( 1 );
			expect( warnSpy.mock.calls[ 0 ][ 0 ] ).toMatch(
				/STUDIO_WPCOM_DEFAULT_HEADERS.*malformed JSON/
			);
		} finally {
			warnSpy.mockRestore();
		}
	} );
} );
