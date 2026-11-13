import fs from 'fs';
import os from 'os';
import path from 'path';
import { ModelRegistry, SessionManager } from '@earendil-works/pi-coding-agent';
import { findAiModel } from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgent } from '@studio/agent/node/agent';
import { OpenProblems } from '@studio/agent/node/open-problems';
import { type StudioAgentTurnConfig } from '@studio/agent/node/runtime';
import { createFakeHost, fakeSite } from '../../tests/fake-host';
import { getSessionState } from '../session-state';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentSessionEvent, CreateAgentSessionOptions } from '@earendil-works/pi-coding-agent';
import type { StudioAgentHost } from '@studio/agent/shared/host';
import type { AiModelId } from '@studio/providers';

const mocks = vi.hoisted( () => ( {
	createAgentSession: vi.fn(),
	createdSessions: [] as FakeSession[],
	nextEvents: null as AgentSessionEvent[] | null,
	continueEvents: [] as AgentSessionEvent[][],
	customMessages: [] as Array< { message: unknown; options: unknown } >,
	turnContexts: [] as string[],
	onCustomMessage: null as ( () => void ) | null,
	studioRoot: '/tmp/studio-ai-pi-runtime',
	bashCwd: '',
	configRoot: '/tmp/studio-ai-pi-runtime-config',
	// What ran, in order: tool executions and the post content check.
	steps: [] as string[],
	postChanges: { summaries: [] as string[], problems: [] as string[], written: [] as string[] },
	runMs: 0,
	settleMs: 0,
	// The text each note on a write was told the tool left, by file.
	leftTexts: [] as Array< [ string, string | undefined ] >,
	afterWriteMs: 0,
	afterWritesAtOnce: [] as number[],
	afterWritesRunning: 0,
	failNext: false,
	// What the checks of what a call changed do as they run, as a save of a template part.
	onSettle: undefined as undefined | ( () => void ),
	// What Studio fixes in a file just written, as its fonts in theme.json.
	fixWrite: undefined as undefined | ( ( file: string ) => string[] ),
	// What each end of a run finds still open on the sites.
	openProblems: [] as string[][],
	// What the end of a run did, in order.
	turnEnd: [] as string[],
	// The next prompt runs until its session is aborted.
	holdNextPrompt: false,
	// Image generation finishes when this is called.
	images: undefined as undefined | { finish?: () => void },
} ) );

// The session's checks of its sites and of their forms, stubbed; the work its tools leave running,
// and the render of the pages they change, are real.
vi.mock( '../session-state', async () => {
	const { PendingWork } = await import( '../pending-work' );
	const { RenderCheck } = await import( '@studio/agent/node/render-check' );
	const { Writers } = await import( '../writers' );
	const states = new WeakMap< object, Record< string, unknown > >();
	return {
		shareSessionState: ( session: object, parent: Record< string, unknown > ) => {
			const state = {
				...parent,
				pendingWork: new PendingWork( parent.pendingWork as InstanceType< typeof PendingWork > ),
			};
			states.set( session, state );
			return state;
		},
		getSessionState: ( host: StudioAgentHost, session: object ) => {
			if ( ! states.has( session ) ) {
				const openProblems = {
					record: () => undefined,
					look: () => [],
					raise: async () => {
						mocks.turnEnd.push( 'sites checked' );
						return mocks.openProblems.shift() ?? [];
					},
					remind: () => [],
				};
				const pendingWork = new PendingWork();
				states.set( session, {
					openProblems,
					pendingWork,
					writers: new Writers( pendingWork ),
					blockValidation: {
						track: () => undefined,
						settle: async () => {
							mocks.turnEnd.push( 'block files settled' );
							return { summaries: [], problems: [], saved: [] };
						},
					},
					renderCheck: new RenderCheck( host, openProblems as never ),
					formCheck: { changed: () => undefined, check: async () => undefined },
				} );
			}
			return states.get( session );
		},
	};
} );

vi.mock( '@studio/agent/node/open-problems', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/agent/node/open-problems') >() ),
	describeOpenProblems: ( problems: string[] ) => `checks: ${ problems.join( ' | ' ) }`,
} ) );

vi.mock( '@earendil-works/pi-coding-agent', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@earendil-works/pi-coding-agent') >();
	const stub = ( name: string ) => ( {
		name,
		label: name,
		description: name,
		parameters: {},
		execute: async () => {
			mocks.steps.push( name );
			await new Promise( ( resolve ) => setTimeout( resolve, mocks.runMs ) );
			if ( mocks.failNext ) {
				mocks.failNext = false;
				throw new Error( 'exit 1' );
			}
			return { content: [ { type: 'text', text: '' } ], details: undefined };
		},
	} );
	return {
		...actual,
		createAgentSession: mocks.createAgentSession,
		createReadTool: () => stub( 'Read' ),
		createWriteTool: () => stub( 'Write' ),
		createEditTool: () => stub( 'Edit' ),
		createBashTool: ( cwd: string ) => {
			mocks.bashCwd = cwd;
			return stub( 'Bash' );
		},
		createGrepTool: () => stub( 'Grep' ),
		createFindTool: () => stub( 'Glob' ),
		createLsTool: () => stub( 'Ls' ),
	};
} );

// Each trigger answers with what it was fired with.
vi.mock( '@studio/agent/shared/tools/utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/agent/shared/tools/utils') >() ),
	siteOfCall: async ( _host: unknown, _tool: unknown, args: { nameOrPath?: string } ) =>
		args?.nameOrPath ? { path: `/sites/${ args.nameOrPath }` } : undefined,
} ) );
vi.mock( '@studio/agent/node/site-notes', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/agent/node/site-notes') >() ),
	createSiteNotes: () => ( {
		beforeWrite: async ( file: string, text = '' ) =>
			file.endsWith( 'refused.php' ) || text.includes( 'refused' )
				? `Not run: ${ file }`
				: undefined,
		afterWrite: async ( file: string, left?: string ) => {
			mocks.leftTexts.push( [ file, left ] );
			mocks.afterWritesAtOnce.push( ++mocks.afterWritesRunning );
			await new Promise( ( resolve ) => setTimeout( resolve, mocks.afterWriteMs ) );
			mocks.afterWritesRunning--;
			return [ `wrote ${ file }` ];
		},
		fixWrite: async ( file: string ) => mocks.fixWrite?.( file ) ?? [],
		afterResult: async ( site: string ) => [ `result on ${ site }` ],
		takeSourceMs: () => ( {} ),
	} ),
} ) );

vi.mock( '@studio/agent/node/site-changes', async () => {
	const { postCopies } = await import( '@studio/agent/node/post-copies' );
	return {
		NO_CHANGES: { summaries: [], problems: [], written: [] },
		SiteChanges: class {
			// As the sources say: a new page's file is published and moved to its copy.
			rewritesWrite( file: string ) {
				return postCopies.rewritesWrite!( file );
			}
			async begin() {
				mocks.steps.push( 'snapshot' );
			}
			end() {}
			afterChecks() {}
			stale() {}
			takeSourceMs() {
				return {};
			}
			async settle() {
				mocks.steps.push( 'settle' );
				await new Promise( ( resolve ) => setTimeout( resolve, mocks.settleMs ) );
				mocks.onSettle?.();
				return mocks.postChanges;
			}
		},
	};
} );

const host = createFakeHost( mocks.studioRoot );
const agent = createAgent( { host } );

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
	public prompts: string[] = [];

	constructor( public options: CreateAgentSessionOptions ) {
		this.state = {
			model: {
				id: options.model?.id ?? '',
				provider: options.model?.provider ?? '',
			},
			messages: options.sessionManager?.buildSessionContext().messages.slice() ?? [],
		};
	}

	agent: {
		transformContext?: ( messages: AgentMessage[] ) => Promise< AgentMessage[] >;
	} = {};

	setActiveToolsByName( names: string[] ): void {
		this.activeToolNames = names;
	}

	get systemPrompt(): string {
		return this.options.resourceLoader?.getSystemPrompt() ?? '';
	}

	subscribe( listener: ( event: AgentSessionEvent ) => void ): () => void {
		this.listener = listener;
		return () => {};
	}

	async prompt( text: string ): Promise< void > {
		this.prompts.push( text );
		if ( mocks.holdNextPrompt ) {
			mocks.holdNextPrompt = false;
			while ( ! this.aborted ) {
				await new Promise( ( resolve ) => setTimeout( resolve, 5 ) );
			}
			throw new Error( 'aborted' );
		}
		const events = mocks.nextEvents ?? DEFAULT_MOCK_EVENTS;
		mocks.nextEvents = null;
		for ( const event of events ) {
			this.listener?.( event );
		}
	}

	get messages(): unknown[] {
		return this.state.messages;
	}

	async sendCustomMessage(
		message: { customType: string; content: string; display: boolean },
		options: { deliverAs?: string }
	): Promise< void > {
		// Pi adds a next-turn message to the session with the prompt it comes with.
		if ( options.deliverAs === 'nextTurn' ) {
			mocks.turnContexts.push( message.content );
			this.options.sessionManager?.appendCustomMessageEntry(
				message.customType,
				message.content,
				message.display
			);
			return;
		}
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

// Studio's notes on the calls so far: its checks run after a call's result,
// and their notes reach the agent with the next one.
async function takeNotes(): Promise< string | undefined > {
	const work = getSessionState(
		host,
		mocks.createdSessions[ 0 ].options.sessionManager as SessionManager
	).pendingWork;
	await work.settle();
	return work.takeReports();
}

// A call's result text, then Studio's notes on it.
async function withNotes(
	call: Promise< { content: Array< { type: string; text: string } > } >
): Promise< Array< string | undefined > > {
	const texts = ( await call ).content.map( ( part ) => part.text );
	const notes = await takeNotes();
	return notes ? [ ...texts, notes ] : texts;
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
	return findAiModel( model )?.provider === 'wpcom'
		? getProviderServices( 'wpcom' ).ai!.model( { token }, model, {} )
		: getProviderServices( 'anthropic' ).ai!.model(
				{ method: 'api-key', apiKey: 'sk-ant-test' },
				model,
				{}
		  );
}

type RuntimeConfig = Omit< StudioAgentTurnConfig, 'onEvent' | 'ai' > & {
	model?: AiModelId;
	token?: string;
};

async function runRuntime( {
	model = 'fast',
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
		mocks.turnContexts = [];
		mocks.onCustomMessage = null;
		mocks.openProblems = [];
		mocks.turnEnd = [];
		mocks.holdNextPrompt = false;
		mocks.createAgentSession.mockReset();
		mocks.createAgentSession.mockImplementation( async ( options: CreateAgentSessionOptions ) => {
			const session = new FakeSession( options );
			mocks.createdSessions.push( session );
			return { session, extensionsResult: { extensions: [], errors: [], runtime: {} } };
		} );
	} );

	it( "starts Bash in the active local site's folder, and says where it starts", async () => {
		const site = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-shell-site-' ) );
		const local = { name: 'A', path: site, running: true };
		for ( const [ activeSite, folder ] of [
			[ local, site ],
			[ { ...local, path: path.join( site, 'gone' ) }, mocks.studioRoot ],
			[ { ...local, remote: { host: 'wpcom', id: 7 } }, mocks.studioRoot ],
			[ undefined, mocks.studioRoot ],
		] as const ) {
			const handle = agent.runTurn( {
				ai: await connect( 'fast' ),
				prompt: 'hello',
				session: newSession(),
				activeSite: activeSite as StudioAgentTurnConfig[ 'activeSite' ],
				onEvent: () => {},
			} );
			await handle.result;
			expect( mocks.bashCwd ).toBe( folder );
			expect( mocks.turnContexts.at( -1 ) ).toContain(
				`- Each Bash command starts in ${ folder }.`
			);
		}
		fs.rmSync( site, { recursive: true, force: true } );
	} );

	// eval23: the system prompt named the user's sites, so the turn after one
	// that created a site sent a new prompt and the provider cache missed on
	// 82-132k tokens. The prompt stays the same; what changed is a message.
	it( 'keeps the system prompt across turns and states a changed site list with the prompt', async () => {
		const all = host.sites.all;
		const session = newSession();
		const turn = async () => {
			const handle = agent.runTurn( {
				ai: await connect( 'fast' ),
				prompt: 'hello',
				session,
				onEvent: () => {},
			} );
			await handle.result;
			return handle.systemPrompt();
		};
		try {
			host.sites.all = async () => [];
			const first = await turn();
			host.sites.all = async () => [ { ...fakeSite, id: '1', name: 'Shop', path: '/sites/shop' } ];
			const second = await turn();
			const third = await turn();

			expect( second ).toBe( first );
			expect( third ).toBe( first );
			expect( first ).not.toContain( 'local sites' );
			expect( mocks.turnContexts ).toHaveLength( 2 );
			expect( mocks.turnContexts[ 0 ] ).toContain( 'the user has no local sites yet' );
			expect( mocks.turnContexts[ 1 ] ).toContain( '"Shop" (/sites/shop)' );
		} finally {
			host.sites.all = all;
		}
	} );

	it( 'reports the system prompt its model requests carry', async () => {
		const handle = agent.runTurn( {
			ai: await connect( 'fast' ),
			prompt: 'hello',
			session: newSession(),
			onEvent: () => {},
		} );
		expect( handle.systemPrompt() ).toBeUndefined();
		await handle.result;
		expect( handle.systemPrompt() ).toMatch( /^You are WordPress Studio, built by Automattic\./ );
	} );

	it( 'runs a call naming an image still being generated once it is done', async () => {
		mocks.images = {};
		host.imageGenerator = async () => ( requests ) =>
			new Promise( ( resolve ) => {
				mocks.images!.finish = () => {
					mocks.steps.push( 'images done' );
					resolve( requests.map( () => ( { ok: false, error: 'not generated' } ) ) );
				};
			} );
		try {
			await runRuntime( { prompt: 'hello', session: newSession() } );
			const image = `${ mocks.studioRoot }/oak/wp-content/themes/oak/hero.png`;
			await getCreatedTool( 'generate_images' ).execute( 't', {
				images: [ { path: image, subject: 'a bench' } ],
			} );
			await getCreatedTool( 'Bash' ).execute( 't', { command: 'ls' } );
			await getCreatedTool( 'Write' ).execute( 't', {
				path: `${ mocks.studioRoot }/oak/home.html`,
				content: `<!-- wp:image --><img src="${ image }"/><!-- /wp:image -->`,
			} );
			const naming = getCreatedTool( 'Bash' ).execute( 't', { command: `file ${ image }` } );
			await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );
			mocks.images.finish!();
			await naming;
			expect(
				mocks.steps.filter( ( step ) => [ 'Bash', 'Write', 'images done' ].includes( step ) )
			).toEqual( [ 'Bash', 'Write', 'images done', 'Bash' ] );
			// A subagent given a task naming an image starts at once; its own
			// calls naming it wait for it.
			await getCreatedTool( 'generate_images' ).execute( 't', {
				images: [ { path: image, subject: 'a bench' } ],
			} );
			mocks.nextEvents = [ { type: 'agent_end', willRetry: false, messages: [] } ];
			await getCreatedTool( 'subagent' ).execute( 's', {
				task: `write a page showing ${ image }`,
			} );
			mocks.steps.length = 0;
			const childBash = (
				mocks.createdSessions.at( -1 )!.options.customTools as unknown as RuntimeTool[]
			 ).find( ( tool ) => tool.name === 'Bash' )!;
			const childNaming = childBash.execute( 't', { command: `file ${ image }` } );
			await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );
			mocks.images.finish!();
			await childNaming;
			expect(
				mocks.steps.filter( ( step ) => [ 'Bash', 'images done' ].includes( step ) )
			).toEqual( [ 'images done', 'Bash' ] );
		} finally {
			mocks.images = undefined;
			delete host.imageGenerator;
		}
	} );

	it( 'activates the tools a skill brings once the skill is loaded', async () => {
		await runRuntime( { prompt: 'hello', session: newSession() } );
		const session = mocks.createdSessions[ 0 ] as unknown as FakeSession;
		expect( session.activeToolNames ).toContain( 'Bash' );
		expect( session.activeToolNames ).not.toContain( 'wp_cli' );
		expect( session.activeToolNames ).not.toContain( 'install_taxonomy_scripts' );
		await getCreatedTool( 'Skill' ).execute( 't', { name: 'taxonomist' } );
		expect( session.activeToolNames ).toContain( 'install_taxonomy_scripts' );
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

	// The tier table is the provider's (wpcom/tests/ai.test.ts); this checks the
	// registration applies the connection's upstream alias and error rewrite.
	it( 'streams with the connection’s upstream model and error rewrite', async () => {
		await runRuntime( { prompt: 'hello', model: 'strong', session: newSession() } );
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
			const [ url, init ] = fetchSpy.mock.calls[ 0 ];
			expect( String( url ) ).toBe( 'https://proxy.example.com/v1/messages?beta=true' );
			expect( JSON.parse( String( init?.body ) ).model ).toBe( 'strong-2' );
			expect( new Headers( init?.headers ).get( 'authorization' ) ).toBe( 'Bearer wpcom-token' );
			expect( result.errorMessage ).toMatch( /^Monthly usage limit reached: / );
		} finally {
			fetchSpy.mockRestore();
		}
	} );

	it( 'offers generate_images only when the host has an image generator', async () => {
		const toolNames = ( index: number ) =>
			( ( mocks.createdSessions[ index ].options.customTools ?? [] ) as { name: string }[] ).map(
				( tool ) => tool.name
			);
		await runRuntime( { prompt: 'hello', model: 'fast', session: newSession() } );
		host.imageGenerator = async () => async () => [];
		try {
			await runRuntime( { prompt: 'hello', model: 'fast', session: newSession() } );
		} finally {
			delete host.imageGenerator;
		}

		expect( toolNames( 0 ) ).not.toContain( 'generate_images' );
		expect( toolNames( 1 ) ).toContain( 'generate_images' );
	} );

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

	describe( 'subagent', () => {
		const usage = ( totalTokens: number ) => ( {
			input: totalTokens,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		} );
		const message = ( text: string, totalTokens: number ) => ( {
			role: 'assistant' as const,
			content: [ { type: 'text' as const, text } ],
			api: 'openai-completions' as const,
			provider: 'studio-wpcom',
			model: 'balanced',
			usage: usage( totalTokens ),
			stopReason: 'stop' as const,
			timestamp: 0,
		} );
		const reply = ( text: string, totalTokens: number ): MessageEndEvent => ( {
			type: 'message_end',
			message: message( text, totalTokens ),
		} );
		const subagentTool = async () => {
			const onAskUser = vi.fn().mockResolvedValue( { 'Delete the site "nope"?': 'No' } );
			await runRuntime( { prompt: 'hello', session: newSession(), onAskUser } );
			return { tool: getCreatedTool( 'subagent' ), onAskUser };
		};
		const child = () => mocks.createdSessions[ 1 ];
		const childTools = () =>
			( ( child().options.customTools ?? [] ) as unknown as RuntimeTool[] ).map(
				( tool ) => tool.name
			);

		it( 'runs the task as a turn of its own and returns its last reply and what it spent', async () => {
			const { tool, onAskUser } = await subagentTool();
			mocks.nextEvents = [
				reply( 'reading the batch', 100 ),
				reply( 'wrote batch-001-results.json: 20 posts', 50 ),
				{ type: 'agent_end', willRetry: false, messages: [] },
			];
			const result = await tool.execute( 's', { task: 'analyze batch-001.json' } );
			expect( child().prompts ).toEqual( [ 'analyze batch-001.json' ] );
			expect( child().options.sessionManager ).not.toBe(
				mocks.createdSessions[ 0 ].options.sessionManager
			);
			expect( result ).toMatchObject( {
				content: [ { type: 'text', text: 'wrote batch-001-results.json: 20 posts' } ],
				details: { usage: { input: 150, totalTokens: 150 }, requests: 2 },
			} );
			// It cannot ask the user, nor run subagents of its own; Studio's confirmations still ask.
			expect( childTools() ).toContain( 'Bash' );
			expect( childTools() ).not.toContain( 'AskUserQuestion' );
			expect( childTools() ).not.toContain( 'subagent' );
			const childDelete = ( child().options.customTools as unknown as RuntimeTool[] ).find(
				( item ) => item.name === 'site_delete'
			)!;
			await expect( childDelete.execute( 't', { nameOrPath: 'nope' } ) ).rejects.toThrow(
				'Not run'
			);
			expect( onAskUser ).toHaveBeenCalledTimes( 1 );
		} );

		it( "leaves the sites as the subagent's turn ends to the parent turn's checks", async () => {
			const { tool } = await subagentTool();
			const done = reply( 'wrote the about page', 10 );
			mocks.nextEvents = [
				done,
				{ type: 'agent_end', willRetry: false, messages: [ done.message ] },
			];
			// Its own turn's end, without the parent's call around it.
			mocks.turnEnd.length = 0;
			await ( tool as unknown as { execute: RuntimeTool[ 'execute' ] } ).execute( 's', {
				task: 'write the about page',
			} );
			expect( mocks.turnEnd.filter( ( step ) => step === 'sites checked' ) ).toEqual( [] );
			expect( mocks.turnEnd ).toContain( 'block files settled' );
		} );

		it( 'gives it the site this request works on as its active site', async () => {
			const site = path.join( mocks.studioRoot, 'shop' );
			const shop = { ...fakeSite, id: '1', name: 'Shop', path: site };
			fs.mkdirSync( site, { recursive: true } );
			const { all, findByFolder } = host.sites;
			host.sites.all = async () => [ shop ];
			host.sites.findByFolder = async ( folder ) =>
				path.resolve( folder ) === path.resolve( site ) ? shop : undefined;
			try {
				const { tool } = await subagentTool();
				await getCreatedTool( 'Write' ).execute( 'w', { path: 'shop/style.css', content: '' } );
				mocks.nextEvents = [ { type: 'agent_end', willRetry: false, messages: [] } ];
				await tool.execute( 's', { task: 'write the about page' } );
				expect( mocks.turnContexts.at( -1 ) ).toContain(
					`- Each Bash command starts in ${ site }.`
				);
			} finally {
				Object.assign( host.sites, { all, findByFolder } );
				fs.rmSync( site, { recursive: true, force: true } );
			}
		} );

		it( 'fails with what stopped the turn', async () => {
			const { tool } = await subagentTool();
			mocks.nextEvents = [
				reply( 'half done', 10 ),
				{
					type: 'agent_end',
					willRetry: false,
					messages: [ { ...message( '', 0 ), stopReason: 'error', errorMessage: 'rate limited' } ],
				},
			];
			await expect( tool.execute( 's', { task: 'analyze' } ) ).rejects.toThrow(
				'The subagent stopped: rate limited. Its last reply: half done'
			);
		} );

		it( 'stops the turn when the call is aborted', async () => {
			const { tool } = await subagentTool();
			mocks.holdNextPrompt = true;
			const controller = new AbortController();
			const running = (
				tool.execute as (
					id: string,
					params: Record< string, unknown >,
					signal: AbortSignal
				) => Promise< unknown >
			 )( 's', { task: 'analyze' }, controller.signal );
			await vi.waitFor( () => expect( child()?.prompts ).toEqual( [ 'analyze' ] ) );
			controller.abort();
			await expect( running ).rejects.toThrow( 'The subagent stopped: aborted' );
			expect( child().aborted ).toBe( true );
		} );
	} );

	it( 'asks the user before a destructive call runs, and does not run it when declined', async () => {
		const onAskUser = vi.fn().mockResolvedValue( { 'Delete the site "nope"?': 'No' } );
		await runRuntime( { prompt: 'hello', session: newSession(), onAskUser } );
		await expect(
			getCreatedTool( 'site_delete' ).execute( 't', { nameOrPath: 'nope' } )
		).rejects.toThrow( 'Not run: the user answered "No" to: Delete the site "nope"?' );
		expect( onAskUser ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'ends the turn, without running the call, when the user closes its question', async () => {
		const onAskUser = vi.fn().mockResolvedValue( {} );
		await runRuntime( { prompt: 'hello', session: newSession(), onAskUser } );
		const result = await getCreatedTool( 'site_delete' ).execute( 't', { nameOrPath: 'nope' } );
		expect( result ).toMatchObject( {
			content: [ { text: expect.stringContaining( 'The user closed without answering' ) } ],
			terminate: true,
		} );
	} );

	it( 'asks the user before a write starts a classic theme, and does not write it when declined', async () => {
		const site = path.join( mocks.studioRoot, 'classic-site' );
		fs.mkdirSync( path.join( site, 'wp-includes' ), { recursive: true } );
		fs.mkdirSync( path.join( site, 'wp-content/themes/yoga' ), { recursive: true } );
		const question = 'Make "yoga" a classic theme?';
		const onAskUser = vi.fn().mockResolvedValue( { [ question ]: 'No' } );
		// WordPress.org updates no theme.
		vi.stubGlobal(
			'fetch',
			async () => new Response( JSON.stringify( { themes: {}, no_update: {} } ) )
		);
		try {
			await runRuntime( { prompt: 'hello', session: newSession(), onAskUser } );
			await expect(
				getCreatedTool( 'Write' ).execute( 'w', {
					path: 'classic-site/wp-content/themes/yoga/index.php',
					content: '<?php get_header();',
				} )
			).rejects.toThrow(
				`Not run: the user answered "No" to: ${ question } "yoga" is to be a block theme`
			);
			expect( onAskUser ).toHaveBeenCalledTimes( 1 );
			expect( fs.existsSync( path.join( site, 'wp-content/themes/yoga/index.php' ) ) ).toBe(
				false
			);
		} finally {
			fs.rmSync( site, { recursive: true, force: true } );
			vi.unstubAllGlobals();
		}
	} );

	it( "returns a call's result before Studio's checks of it, which the next call waits for", async () => {
		await runRuntime( {
			prompt: 'hello',
			session: newSession(),
			activeSite: {
				name: 'A',
				path: '/sites/a',
				running: false,
			} as StudioAgentTurnConfig[ 'activeSite' ],
		} );
		mocks.runMs = 60;
		mocks.settleMs = 40;
		try {
			const write = async () =>
				(
					( await getCreatedTool( 'Write' ).execute( 'w', {
						path: 'a/style.css',
						content: '',
					} ) ) as unknown as {
						details: { checksMs: number; checkStagesMs: Record< string, number > };
					}
				 ).details;
			// The check the mock delays runs after the result, apart from the run.
			const first = await write();
			expect( first.checksMs ).toBeLessThan( 39 );
			// The next call waits for it.
			const second = await write();
			expect( second.checkStagesMs.previousChecks ).toBeGreaterThanOrEqual( 30 );
			expect( second.checksMs ).toBeGreaterThanOrEqual( second.checkStagesMs.previousChecks );
			expect( second.checksMs ).toBeLessThan( 60 );
			// With the time of the first call's checks, which ran after it returned.
			expect( second.checkStagesMs[ 'after siteChanges' ] ).toBeGreaterThanOrEqual( 30 );
			expect( Object.keys( second.checkStagesMs ).sort() ).toEqual( [
				'after fileNotes',
				'after render',
				'after resultNotes',
				'after siteChanges',
				'blockValidation',
				'fileFixes',
				'pendingWork',
				'previousChecks',
				'render',
				'siteChanges',
			] );
		} finally {
			await takeNotes();
			mocks.runMs = 0;
			mocks.settleMs = 0;
		}
	} );

	// eval26 picky4: a render's verdict came on the result of the call that copied
	// pages into the workspace, before Studio saved the copies to their posts.
	it( "holds a render's verdict until the call's own checks have saved what it changed", async () => {
		await runRuntime( {
			prompt: 'hello',
			session: newSession(),
			activeSite: {
				name: 'A',
				path: '/sites/a',
				running: false,
			} as StudioAgentTurnConfig[ 'activeSite' ],
		} );
		// A verdict waits: the browser that renders the pages does not run here.
		const { RenderCheck } = await import( '@studio/agent/node/render-check' );
		const waiting = vi.spyOn( RenderCheck.prototype, 'hasReports' ).mockReturnValue( true );
		const taken = vi
			.spyOn( RenderCheck.prototype, 'takeReports' )
			.mockImplementation( async () => ( mocks.steps.push( 'verdict taken' ), '' ) );
		mocks.settleMs = 40;
		try {
			await getCreatedTool( 'Bash' ).execute( 'b', { command: 'cp 12.html page/12.html' } );
			expect( mocks.steps.slice( mocks.steps.lastIndexOf( 'Bash' ) ) ).toEqual( [
				'Bash',
				'settle',
				'verdict taken',
			] );
		} finally {
			waiting.mockRestore();
			taken.mockRestore();
			await takeNotes();
			mocks.settleMs = 0;
		}
	} );

	it( "carries a site tool's own checks, the site's facts among them, in its result", async () => {
		await runRuntime( {
			prompt: 'hello',
			session: newSession(),
			activeSite: {
				name: 'A',
				path: '/sites/a',
				running: false,
			} as StudioAgentTurnConfig[ 'activeSite' ],
		} );
		mocks.settleMs = 20;
		try {
			const result = ( await getCreatedTool( 'site_info' )
				.execute( 's', { nameOrPath: 'A' } )
				.catch( ( error: Error ) => ( {
					content: [ { type: 'text', text: error.message } ],
				} ) ) ) as {
				content: Array< { type: string; text: string } >;
			};
			expect( result.content.map( ( part ) => part.text ).join( '\n' ) ).toContain(
				'<studio-notes>\nresult on '
			);
			expect( await takeNotes() ).toBeUndefined();
		} finally {
			mocks.settleMs = 0;
		}
	} );

	it( 'tells the notes the text the file tool left, before Studio acts on it', async () => {
		await runRuntime( { prompt: 'hello', session: newSession() } );
		const file = path.resolve( mocks.studioRoot, 'a/style.css' );
		const other = '/sites/a/wp-content/themes/t/theme.json';
		fs.mkdirSync( path.dirname( file ), { recursive: true } );
		fs.writeFileSync( file, 'as the tool left it' );
		mocks.postChanges.written = [ other ];
		mocks.leftTexts.length = 0;
		try {
			await getCreatedTool( 'Write' ).execute( 'w', { path: 'a/style.css', content: '' } );
			await takeNotes();
		} finally {
			mocks.postChanges.written = [];
			fs.rmSync( file, { force: true } );
		}

		expect( mocks.leftTexts ).toEqual( [
			[ file, 'as the tool left it' ],
			[ other, undefined ],
		] );
	} );

	// An Edit of `file` that misses a text like no line of it, as its error reads.
	const missedEdit = async ( file: string ) => {
		mocks.failNext = true;
		return getCreatedTool( 'Edit' )
			.execute( 'e', { path: file, edits: [ { oldText: 'x', newText: 'y' } ] } )
			.then(
				() => '',
				( error: Error ) => error.message
			);
	};

	// eval5-9: 7 branch Edits missed their text in a file Studio had rewritten
	// since the agent wrote it (its fonts, its blocks), and the agent re-read it;
	// eval30: 3 of 5 still re-read it after a diff of the changes with gaps.
	it.each< { case: string; oldText: string; notes: string[] } >( [
		{
			case: 'where the file now reads closest to the text it looked for',
			oldText: 'line 2\nline 3',
			notes: [
				'changed after your Write of it. Where it now reads closest to the text the Edit looked for:',
				'Lines 1-6 now read:',
				'~~~',
				...[ 'line 0', 'line 1', 'line 2!', 'line 3', 'line 4', 'line 5' ],
				'~~~',
			],
		},
		{
			case: 'how the file changed since the agent held it, for a text like no line',
			oldText: 'x',
			notes: [
				'changed after your Write of it; every other line reads as your Write left it.',
				...[ 'Lines 3-3 now read:', '~~~', 'line 2!', '~~~' ],
				...[ 'Lines 10-10 now read:', '~~~', 'line 9!', '~~~' ],
			],
		},
	] )( 'shows an Edit missing its text $case', async ( { oldText, notes } ) => {
		await runRuntime( { prompt: 'hello', session: newSession() } );
		const file = path.resolve( mocks.studioRoot, 'a/theme.json' );
		const lines = Array.from( { length: 12 }, ( _, index ) => `line ${ index }` );
		fs.mkdirSync( path.dirname( file ), { recursive: true } );
		const failedEdit = async ( text: string ) => {
			mocks.failNext = true;
			return getCreatedTool( 'Edit' )
				.execute( 'e', { path: 'a/theme.json', edits: [ { oldText: text, newText: 'y' } ] } )
				.then(
					() => '',
					( error: Error ) => error.message
				);
		};
		try {
			fs.writeFileSync( file, lines.join( '\n' ) );
			await getCreatedTool( 'Write' ).execute( 'w', { path: 'a/theme.json', content: '' } );
			await takeNotes();
			// Studio saves a fix to two of its lines.
			fs.writeFileSync(
				file,
				lines
					.map( ( line, index ) => ( [ 2, 9 ].includes( index ) ? `${ line }!` : line ) )
					.join( '\n' )
			);
			// Read in part, the file is still told from the text the agent wrote.
			await getCreatedTool( 'Read' ).execute( 'r', { path: 'a/theme.json', offset: 1, limit: 2 } );
			expect( await failedEdit( oldText ) ).toBe(
				[ 'exit 1', '<studio-notes>', `${ file } ${ notes[ 0 ] }`, ...notes.slice( 1 ) ]
					.join( '\n' )
					.concat( '\n</studio-notes>' )
			);
			// Read whole, the file is as the agent holds it.
			await getCreatedTool( 'Read' ).execute( 'r', { path: 'a/theme.json' } );
			expect( await failedEdit( 'x' ) ).toBe( 'exit 1' );
			// An Edit missing its text in a file as the agent holds it hears where it reads closest.
			expect( await failedEdit( '  line 7 ' ) ).toBe(
				[
					'exit 1',
					'<studio-notes>',
					`Where ${ file } reads closest to the text the Edit looked for:`,
					'Lines 6-10 now read:',
					'~~~',
					...[ 'line 5', 'line 6', 'line 7', 'line 8', 'line 9!' ],
					'~~~',
					'</studio-notes>',
				].join( '\n' )
			);
		} finally {
			fs.rmSync( file, { force: true } );
		}
	} );

	// A Read of part of a file the agent wrote leaves the whole it holds,
	// which what Studio changes in it since is told from.
	it( 'tells what changed in a file it wrote after a Read of part of it', async () => {
		await runRuntime( { prompt: 'hello', session: newSession() } );
		const file = path.resolve( mocks.studioRoot, 'a/theme.json' );
		fs.mkdirSync( path.dirname( file ), { recursive: true } );
		try {
			fs.writeFileSync( file, 'one\ntwo\nthree' );
			await getCreatedTool( 'Write' ).execute( 'w', { path: 'a/theme.json', content: '' } );
			await getCreatedTool( 'Read' ).execute( 'r', { path: 'a/theme.json', offset: 2 } );
			await takeNotes();
			fs.writeFileSync( file, 'one\nTWO\nthree' );
			expect( await missedEdit( 'a/theme.json' ) ).toContain(
				`${ file } changed after your Write of it;`
			);
		} finally {
			fs.rmSync( file, { force: true } );
		}
	} );

	// eval19: in 2 of 5 branch runs Studio self-hosted theme.json's fonts after
	// its Write returned, so the agent's next Edit, made from the text it wrote, failed.
	it( 'reports what Studio fixes in a file it wrote on the file tool result', async () => {
		await runRuntime( { prompt: 'hello', session: newSession() } );
		const file = path.resolve( mocks.studioRoot, 'a/theme.json' );
		fs.mkdirSync( path.dirname( file ), { recursive: true } );
		fs.writeFileSync( file, 'one\ntwo\nthree' );
		mocks.fixWrite = ( fixed ) => {
			fs.writeFileSync( fixed, 'one\nTWO\nthree' );
			return [ 'Studio self-hosted the fonts.' ];
		};
		try {
			const result = ( await getCreatedTool( 'Write' ).execute( 'w', {
				path: 'a/theme.json',
				content: '',
			} ) ) as { content: Array< { text: string } > };
			expect( result.content.map( ( part ) => part.text ).join( '\n' ) ).toContain(
				[
					'<studio-notes>',
					'Studio self-hosted the fonts.',
					`Studio changed ${ file } after the write; every other line reads as written.`,
					'Lines 2-2 now read:\n~~~\nTWO\n~~~',
				].join( '\n' )
			);
			await takeNotes();
			// Quoted whole, the fix is in the text the agent holds.
			expect( await missedEdit( 'a/theme.json' ) ).toBe( 'exit 1' );
			// So is what the notes after the call quote whole of the file it wrote.
			mocks.fixWrite = undefined;
			mocks.onSettle = () => fs.writeFileSync( file, 'one\nTWO\nTHREE' );
			await getCreatedTool( 'Write' ).execute( 'w', { path: 'a/theme.json', content: '' } );
			await takeNotes();
			expect( await missedEdit( 'a/theme.json' ) ).toBe( 'exit 1' );
		} finally {
			mocks.fixWrite = undefined;
			mocks.onSettle = undefined;
			fs.rmSync( file, { force: true } );
		}
		// The notes after the call start from the file as Studio left it.
		expect( mocks.leftTexts.at( -2 ) ).toEqual( [ file, 'one\nTWO\nthree' ] );
	} );

	// eval30 pivot and pileon ports: the Write of a new page's file returned
	// before Studio published it and moved it to the page's copy, so the
	// agent's next Read or Edit of the file it wrote found nothing there.
	it( "says on a write's own result that a check moved the file it wrote", async () => {
		await runRuntime( { prompt: 'hello', session: newSession() } );
		const workspace = path.join( mocks.configRoot, 'workspace/site-id' );
		const file = path.join( workspace, 'page/private-events.html' );
		const copy = path.join( workspace, 'page/44.html' );
		const created = `Studio created page 44 "Private Events" (/private-events/) from ${ file }; its content is now in ${ copy }.`;
		mocks.settleMs = 20;
		mocks.postChanges = { summaries: [ created ], problems: [], written: [] };
		const write = async ( written: string ) =>
			(
				( await getCreatedTool( 'Write' ).execute( 'w', {
					path: written,
					content: '',
				} ) ) as { content: Array< { text: string } > }
			 ).content
				.map( ( part ) => part.text )
				.join( '\n' );
		try {
			expect( await write( file ) ).toBe(
				[ '', '<studio-notes>', created, `wrote ${ file }`, '</studio-notes>' ].join( '\n' )
			);
			expect( await takeNotes() ).toBeUndefined();
			// A post's copy is saved to its post where it is: its checks follow its result.
			expect( await write( copy ) ).toBe( '' );
			expect( await takeNotes() ).toBe( `${ created }\nwrote ${ copy }` );
		} finally {
			mocks.settleMs = 0;
			mocks.postChanges = { summaries: [], problems: [], written: [] };
		}
	} );

	// eval30 pileon port: Studio saved parts/footer.html with a spacing preset
	// while checking a page the agent wrote, and said only "Studio saved
	// parts/footer.html", so the agent's next Edit of the footer missed its text.
	it( 'says how a check changed another file the agent holds, as it says of a file written', async () => {
		await runRuntime( { prompt: 'hello', session: newSession() } );
		const footer = path.resolve( mocks.studioRoot, 'a/parts/footer.html' );
		const page = path.resolve( mocks.studioRoot, 'a/page.html' );
		fs.mkdirSync( path.dirname( footer ), { recursive: true } );
		fs.writeFileSync( footer, 'one\npadding:4rem\nthree' );
		fs.writeFileSync( page, 'page' );
		try {
			await getCreatedTool( 'Read' ).execute( 'r', { path: 'a/parts/footer.html' } );
			await getCreatedTool( 'Read' ).execute( 'r', { path: 'a/page.html' } );
			await takeNotes();
			// The call's own change to a file is the agent's, not Studio's.
			fs.writeFileSync( footer, 'one\npadding:4rem\nthree\n' );
			await getCreatedTool( 'Bash' ).execute( 'b', { command: 'true' } );
			expect( await takeNotes() ).toBeUndefined();
			mocks.onSettle = () => {
				fs.writeFileSync( footer, 'one\npadding:var(--wp--preset--spacing--size-4-rem)\nthree' );
				// The file the call writes says what changed in it with its own notes.
				fs.writeFileSync( page, 'page, fixed' );
			};
			await getCreatedTool( 'Write' ).execute( 'w', { path: 'a/page.html', content: '' } );
			expect( await takeNotes() ).toBe(
				[
					`wrote ${ page }`,
					`Studio changed ${ footer } after the write; every other line reads as written.`,
					'Lines 2-2 now read:',
					'~~~',
					'padding:var(--wp--preset--spacing--size-4-rem)',
					'~~~',
				].join( '\n' )
			);
			// Quoted whole, the change is the agent's to edit from: an Edit missing
			// its text hears of no change since.
			expect( await missedEdit( 'a/parts/footer.html' ) ).toBe( 'exit 1' );
		} finally {
			mocks.onSettle = undefined;
			fs.rmSync( footer, { force: true } );
			fs.rmSync( page, { force: true } );
		}
	} );

	// port c-2 climbing-gym: three files' notes each added a preset to theme.json
	// at once, and the writes left one theme.json with another's end after it.
	it( 'runs the notes on each file a call wrote, and on parallel calls, one at a time', async () => {
		mocks.createdSessions.length = 0;
		await runRuntime( { prompt: 'hello', session: newSession() } );
		mocks.postChanges.written = [ '/sites/parallel/header.html', '/sites/parallel/footer.html' ];
		mocks.afterWriteMs = 10;
		mocks.afterWritesAtOnce.length = 0;
		try {
			const write = getCreatedTool( 'Write' );
			await Promise.all( [
				write.execute( 'w1', { path: 'parallel/style.css', content: '' } ),
				write.execute( 'w2', { path: 'parallel/theme.json', content: '' } ),
			] );
			await takeNotes();
		} finally {
			mocks.postChanges.written = [];
			mocks.afterWriteMs = 0;
		}
		expect( mocks.afterWritesAtOnce ).toHaveLength( 6 );
		expect( Math.max( ...mocks.afterWritesAtOnce ) ).toBe( 1 );
	} );

	it( 'fires the site notes triggers on a write, and on a result for a local active site', async () => {
		const run = async ( activeSite: StudioAgentTurnConfig[ 'activeSite' ] ) => {
			mocks.createdSessions.length = 0;
			await runRuntime( { prompt: 'hello', session: newSession(), activeSite } );
			return getCreatedTool( 'Write' );
		};
		const local = {
			name: 'A',
			path: '/sites/a',
			running: false,
		} as StudioAgentTurnConfig[ 'activeSite' ];
		const write = await run( local );
		const file = path.resolve( mocks.studioRoot, 'a/style.css' );
		const text = ( params: Record< string, unknown > ) => withNotes( write.execute( 'w', params ) );

		await expect( write.execute( 'w', { path: 'a/refused.php', content: '' } ) ).rejects.toThrow(
			`Not run: ${ path.resolve( mocks.studioRoot, 'a/refused.php' ) }`
		);
		// What the call writes is refused too.
		await expect(
			write.execute( 'w', { path: 'a/style.css', content: 'refused' } )
		).rejects.toThrow( 'Not run:' );
		expect( await text( { path: 'a/style.css', content: '' } ) ).toEqual( [
			'',
			`wrote ${ file }\nresult on ${ path.resolve( '/sites/a' ) }`,
		] );
		const remote = await run( {
			...local!,
			remote: { host: 'wpcom', id: 7 },
		} as StudioAgentTurnConfig[ 'activeSite' ] );
		expect(
			await withNotes( remote.execute( 'w', { path: 'a/style.css', content: '' } ) )
		).toEqual( [ '', `wrote ${ file }` ] );

		// A call that names a local site reports on it, as one creating a site does.
		const none = await run( undefined );
		expect(
			await withNotes( none.execute( 'w', { path: 'a/style.css', content: '', nameOrPath: 'b' } ) )
		).toEqual( [ '', `wrote ${ file }\nresult on /sites/b` ] );

		// A file any call wrote gets the same notes, once though a file tool wrote it too.
		mocks.postChanges.written = [ file, '/sites/a/wp-content/themes/t/style.css' ];
		expect(
			await withNotes( ( await run( local ) ).execute( 'w', { path: 'a/style.css', content: '' } ) )
		).toEqual( [
			'',
			`wrote ${ file }\nwrote /sites/a/wp-content/themes/t/style.css\nresult on ${ path.resolve(
				'/sites/a'
			) }`,
		] );
		mocks.postChanges.written = [ '/sites/a/wp-content/themes/t/style.css' ];
		await run( local );
		expect(
			await withNotes( getCreatedTool( 'Bash' ).execute( 'b', { command: 'true' } ) )
		).toEqual( [
			'',
			`wrote /sites/a/wp-content/themes/t/style.css\nresult on ${ path.resolve( '/sites/a' ) }`,
		] );
		mocks.postChanges.written = [];
	} );

	it( 'restates the facts of the site a request without one first changes, after each call', async () => {
		const site = path.join( mocks.studioRoot, 'shop' );
		const all = host.sites.all;
		host.sites.all = async () => [ { ...fakeSite, id: '1', name: 'Shop', path: site } ];
		try {
			mocks.createdSessions.length = 0;
			await runRuntime( { prompt: 'hello', session: newSession() } );
			const bash = () => withNotes( getCreatedTool( 'Bash' ).execute( 'b', { command: 'true' } ) );
			expect( await bash() ).toEqual( [ '' ] );
			await withNotes(
				getCreatedTool( 'Write' ).execute( 'w', { path: 'shop/style.css', content: '' } )
			);
			// As a shell command installing a plugin changes the site's facts.
			expect( await bash() ).toEqual( [ '', `result on ${ path.resolve( site ) }` ] );
		} finally {
			host.sites.all = all;
			fs.rmSync( site, { recursive: true, force: true } );
		}
	} );

	it( 'reports the post content a call changed, from a snapshot taken before it', async () => {
		mocks.createdSessions.length = 0;
		await runRuntime( { prompt: 'hello', session: newSession() } );
		mocks.steps.length = 0;
		mocks.postChanges = {
			summaries: [ 'page 9 changed' ],
			problems: [ 'page 9 problem' ],
			written: [],
		};
		const result = await getCreatedTool( 'Bash' ).execute( 'b', { command: 'true' } );
		expect( mocks.steps ).toEqual( [ 'snapshot', 'Bash', 'settle' ] );
		expect( result.content.map( ( part ) => part.text ) ).toEqual( [ '' ] );
		// Its notes come with the next result, and the context has them on its own:
		// eval9 picky 1 heard a palette's old colors right after the call that rewrote it.
		const next = ( await getCreatedTool( 'Read' ).execute( 'r', {
			path: 'a/style.css',
		} ) ) as { content: Array< { text: string } >; details?: unknown };
		expect( next.content.map( ( part ) => part.text ) ).toEqual( [ '' ] );
		const toolResult = ( toolCallId: string, details?: unknown ) =>
			( {
				role: 'toolResult',
				toolCallId,
				content: [ { type: 'text', text: '' } ],
				details,
			} ) as unknown as AgentMessage;
		const context = mocks.createdSessions[ 0 ].agent.transformContext!;
		const texts = async ( messages: AgentMessage[] ) =>
			( await context( messages ) ).map( ( message ) =>
				( message as { content: Array< { text: string } > } ).content.map( ( part ) => part.text )
			);
		const notes = '<studio-notes>\npage 9 changed\npage 9 problem\n</studio-notes>';
		expect( await texts( [ toolResult( 'b' ), toolResult( 'r', next.details ) ] ) ).toEqual( [
			[ '', notes ],
			[ '' ],
		] );
		// Without its call's result, as a compacted context has, they stay on the next.
		expect( await texts( [ toolResult( 'r', next.details ) ] ) ).toEqual( [ [ '', notes ] ] );
		// A failed call reports what it changed too.
		mocks.failNext = true;
		await expect( getCreatedTool( 'Bash' ).execute( 'b', { command: 'false' } ) ).rejects.toThrow(
			'exit 1\n<studio-notes>\npage 9 changed\npage 9 problem\n</studio-notes>'
		);
		// A tool that only reads changes nothing to check, as Studio's tools declare.
		mocks.steps.length = 0;
		await getCreatedTool( 'Read' ).execute( 'r', { path: 'a/style.css' } );
		await getCreatedTool( 'Skill' ).execute( 's', { name: 'taxonomist' } );
		expect( mocks.steps ).toEqual( [ 'Read' ] );
		mocks.postChanges = { summaries: [], problems: [], written: [] };
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
			model: 'balanced',
			session: newSession(),
		} );

		await expect(
			getCreatedTool( 'Bash' ).execute( 'bash-call-1', {
				command: 'wp post update 4 --post_content="<!-- wp:paragraph --><p>partial',
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

		it( 'continues a finished turn with the problems still open on the sites, until none are', async () => {
			mocks.nextEvents = runEndingWith( assistantMessage( [ { type: 'text', text: 'Done.' } ] ) );
			mocks.continueEvents = [
				runEndingWith( assistantMessage( [ { type: 'text', text: 'Fixed.' } ] ) ),
			];
			mocks.openProblems = [ [ 'page 9: 2 invalid blocks', 'front page not shown' ] ];

			const events = await runFast();

			expect( mocks.customMessages ).toEqual( [
				{
					message: {
						customType: 'studio.open_problems',
						content: 'checks: page 9: 2 invalid blocks | front page not shown',
						display: false,
					},
					options: { triggerTurn: true },
				},
			] );
			const ends = agentEnds( events );
			expect( ends.map( ( event ) => event.willRetry ) ).toEqual( [ true, false ] );
			expect( ends[ 1 ].messages[ 0 ] ).toMatchObject( { content: [ { text: 'Fixed.' } ] } );
			// eval5-7: the reply the checks came after reached the user as the
			// turn's end, and the reply after them was about Studio's checks.
			// The turn continues from before it: neither the user nor the agent sees it.
			const replies = events.flatMap( ( event ) =>
				event.type === 'message_end' && event.message.role === 'assistant'
					? event.message.content.flatMap( ( block ) =>
							block.type === 'text' ? block.text : []
					  )
					: []
			);
			expect( replies ).toEqual( [ 'Fixed.' ] );
			const lastCall = { role: 'toolResult', toolCallId: 'call-1' } as unknown as AgentMessage;
			const checks = {
				role: 'custom',
				customType: 'studio.open_problems',
			} as unknown as AgentMessage;
			const reply = ( text: string ) =>
				( { role: 'assistant', content: [ { type: 'text', text } ] } ) as unknown as AgentMessage;
			const context = mocks.createdSessions[ 0 ].agent.transformContext!;
			expect( await context( [ lastCall, reply( 'Done.' ), checks, reply( 'Fixed.' ) ] ) ).toEqual(
				[ lastCall, checks, reply( 'Fixed.' ) ]
			);
		} );

		// eval31 onepage port 1: an invalid core/site-title in parts/footer.html,
		// raised as the turn ended, was left as it was and shipped.
		describe( 'the invalid blocks left as they were as the turn ends', () => {
			const footer = [
				'parts/footer.html: 1 block(s) the editor shows as invalid: each differs from what the block saves:',
				'  - core/site-title: saving it drops its font family.',
			].join( '\n' );
			const reminder =
				"<studio-checks>\nStudio checked the sites again as the turn ends: these blocks are still invalid on the site, as noted above. The turn is done when each is fixed, or, for one that needs the user's choice, when the user is asked:\n- parts/footer.html: core/site-title\n</studio-checks>";
			const done = () => runEndingWith( assistantMessage( [ { type: 'text', text: 'Done.' } ] ) );
			const turn = ( session: SessionManager ) =>
				runRuntime( { prompt: 'build it', model: 'fast', session } );
			const withOpenProblems = () => {
				const session = newSession();
				const open = new OpenProblems( [] );
				Object.assign( getSessionState( host, session ), { openProblems: open } );
				open.record( '/a', '/a/parts/footer.html', footer );
				return { session, open };
			};
			const sent = () =>
				mocks.customMessages.map( ( { message } ) => ( message as { content: string } ).content );

			it( 'are said once more, once, as the turn ends', async () => {
				const { session } = withOpenProblems();
				mocks.nextEvents = done();
				mocks.continueEvents = [ done(), done(), done() ];

				const events = await turn( session );

				expect( sent() ).toEqual( [ expect.stringContaining( footer ), reminder ] );
				expect( agentEnds( events ).map( ( event ) => event.willRetry ) ).toEqual( [
					true,
					true,
					false,
				] );
				mocks.customMessages = [];
				mocks.nextEvents = done();
				await turn( session );
				expect( sent() ).toEqual( [] );
			} );

			it( 'wait for an end with nothing new raised', async () => {
				const { session, open } = withOpenProblems();
				mocks.nextEvents = done();
				mocks.continueEvents = [ done(), done(), done() ];
				mocks.onCustomMessage = () => {
					open.record( '/a', '/a/theme.json', 'theme.json drops a key' );
					mocks.onCustomMessage = null;
				};

				await turn( session );

				expect( sent() ).toEqual( [
					expect.stringContaining( footer ),
					'checks: theme.json drops a key',
					reminder,
				] );
			} );

			it( 'are not said once fixed', async () => {
				const { session, open } = withOpenProblems();
				mocks.nextEvents = done();
				mocks.continueEvents = [ done(), done() ];
				mocks.onCustomMessage = () => open.record( '/a', '/a/parts/footer.html' );

				await turn( session );

				expect( sent() ).toEqual( [ expect.stringContaining( footer ) ] );
			} );
		} );

		it( 'shows a reply the checks find nothing after as it is', async () => {
			mocks.nextEvents = runEndingWith( assistantMessage( [ { type: 'text', text: 'Done.' } ] ) );

			expect( findAssistantText( await runFast() ) ).toBe( 'Done.' );
		} );

		it( "continues a finished turn with the notes on the run's last calls", async () => {
			mocks.nextEvents = runEndingWith( assistantMessage( [ { type: 'text', text: 'Done.' } ] ) );
			mocks.continueEvents = [
				runEndingWith( assistantMessage( [ { type: 'text', text: 'Fixed.' } ] ) ),
			];
			mocks.openProblems = [ [ 'front page not shown' ] ];
			const session = newSession();
			getSessionState( host, session ).pendingWork.add( Promise.resolve( 'page 9 changed' ) );

			await runRuntime( { prompt: 'build it', model: 'fast', session } );

			expect( mocks.customMessages.map( ( { message } ) => message ) ).toEqual( [
				{
					customType: 'studio.open_problems',
					content: '<studio-notes>\npage 9 changed\n</studio-notes>\nchecks: front page not shown',
					display: false,
				},
			] );
		} );

		it( 'checks the sites once the block files the run wrote are validated', async () => {
			mocks.nextEvents = runEndingWith( assistantMessage( [ { type: 'text', text: 'Done.' } ] ) );

			await runFast();

			expect( mocks.turnEnd ).toEqual( [ 'block files settled', 'sites checked' ] );
		} );

		it( 'ends the turn as interrupted when the user stops it first', async () => {
			mocks.nextEvents = runEndingWith( emptyReply() );
			const events: AgentSessionEvent[] = [];
			const handle = agent.runTurn( {
				ai: await connect( 'fast' ),
				prompt: 'build it',
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

	// The registered key wins over pi's own environment lookup.
	it( 'runs Anthropic models on the connection key, not the environment', async () => {
		vi.stubEnv( 'ANTHROPIC_API_KEY', 'sk-ant-from-env' );
		await runRuntime( { prompt: 'hello', model: 'claude-sonnet-5-5', session: newSession() } );

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
