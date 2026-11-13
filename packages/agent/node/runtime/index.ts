import fs from 'fs';
import path from 'path';
import { type AgentMessage, type AgentTool } from '@earendil-works/pi-agent-core';
import { type Credential, type CredentialInfo, type CredentialStore } from '@earendil-works/pi-ai';
import {
	createAgentSession,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	DefaultResourceLoader,
	ModelRuntime,
	SettingsManager,
	type AgentSession,
	type AgentSessionEvent,
	SessionManager,
} from '@earendil-works/pi-coding-agent';
import { type TSchema } from 'typebox';
import { environmentFacts } from '@studio/agent/node/environment-facts';
import { readGlobalInstructions } from '@studio/agent/node/global-instructions';
import {
	describeOpenProblems,
	describeStillInvalid,
	withoutNoted,
} from '@studio/agent/node/open-problems';
import { SiteChanges } from '@studio/agent/node/site-changes';
import { readActiveSiteFacts } from '@studio/agent/node/site-facts';
import { createSiteNotes } from '@studio/agent/node/site-notes';
import { nodeStudioToolDefinitions } from '@studio/agent/node/tools';
import { readUserSkills } from '@studio/agent/node/user-skills';
import {
	findLastAssistant,
	getEmptyStopContinuation,
	isEmptyStop,
	MAX_EMPTY_STOP_CONTINUES,
} from '@studio/agent/protocol/session-events';
import { createConnectionStream } from '@studio/agent/shared/models';
import { studioMessage } from '@studio/agent/shared/studio-message';
import { buildSystemPrompt, buildTurnContext } from '@studio/agent/shared/system-prompt';
import { resolveConversationTools } from '@studio/agent/shared/tools';
import { withStringEdits } from '@studio/agent/shared/tools/edit-arguments';
import { withDefaultTimeout } from './bash-timeout';
import { placeCallNotes } from './call-notes';
import { createConfirmer } from './confirmation';
import { FileViews } from './file-views';
import {
	endsTurn,
	OPEN_PROBLEMS_TYPE,
	withoutContinuedReplies,
	withoutReplyText,
} from './held-reply';
import { createMcpTools, isUserMcpTool, readMcpServers } from './mcp-tools';
import { changesPreview } from './preview-reload';
import { getSessionState, shareSessionState, type SessionState } from './session-state';
import { SitePin } from './site-pin';
import { SkillToolScope } from './skill-tool-scope';
import { agentShell, ensureStudioShimDirectory, getStudioShims } from './studio-wp-shim';
import { createSubagentTool } from './subagent';
import { withTextOnlyImages } from './text-only-read';
import { AfterChecks, toToolDefinition } from './tool-checks';
import { type StudioToolPayloadGuardState, updateStudioToolPayloadGuardState } from './tool-safety';
import { serveWpCli } from './wp-cli-server';
import type { StudioChatImage } from '@studio/agent/protocol/chat-images';
import type { StudioAgentHost } from '@studio/agent/shared/host';
import type { Skill } from '@studio/agent/shared/skills';
import type { AskUserHandler, SiteInfo } from '@studio/agent/shared/types';
import type { AiConnection } from '@studio/providers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;
type ProviderConfigInput = Parameters< ModelRuntime[ 'registerProvider' ] >[ 1 ];

const EMPTY_STOP_CONTINUE_TYPE = 'studio.empty_stop_continue';
const STUDIO_COMPACTION_SETTINGS = {
	enabled: true,
	reserveTokens: 16_384,
	keepRecentTokens: 20_000,
};

export interface StudioAgentTurnConfig {
	prompt: string;
	images?: StudioChatImage[];
	session: SessionManager;
	// The model to run on, as the provider serving it connects to it.
	ai: AiConnection;
	activeSite?: SiteInfo | null;
	onAskUser?: AskUserHandler;
	// Answers the harness's confirmations of irreversible calls. Defaults to
	// onAskUser; a scripted user (the eval runner) answers without exposing
	// AskUserQuestion to the agent.
	onConfirm?: AskUserHandler;
	onEvent: ( event: AgentSessionEvent ) => void;
	// A turn run for another turn's subagent call, which runs no subagents of its own.
	subagentOf?: SubagentParent;
}

/**
 * The turn running a subagent: the subagent shares its session's state and
 * its check of what calls change, so each agent hears what Studio finds in
 * what it wrote, and the parent turn's own checks cover the rest.
 */
interface SubagentParent {
	state: SessionState;
	siteChanges: SiteChanges;
}

interface ResolvedStudioAgentTurnConfig extends StudioAgentTurnConfig {
	host: StudioAgentHost;
}

export interface StudioAgentTurnHandle {
	result: Promise< void >;
	interrupt(): Promise< void >;
	/** Whether `name` is one of the turn's registered tools, not a name the model made up. */
	hasTool( name: string ): boolean;
	/** The system prompt the turn's model requests carry, once its session is set up. */
	systemPrompt(): string | undefined;
}

export function runStudioAgentTurn(
	host: StudioAgentHost,
	config: StudioAgentTurnConfig
): StudioAgentTurnHandle {
	const controller = new AbortController();
	let activeSession: AgentSession | undefined;
	let systemPrompt: string | undefined;
	const resolvedConfig: ResolvedStudioAgentTurnConfig = { ...config, host };

	if ( ! fs.existsSync( host.sitesRoot ) ) {
		fs.mkdirSync( host.sitesRoot, { recursive: true } );
	}

	const result = runAgentSessionTurn( resolvedConfig, controller, ( session ) => {
		activeSession = session;
		systemPrompt = session?.systemPrompt ?? systemPrompt;
	} );

	return {
		result,
		async interrupt() {
			controller.abort();
			await activeSession?.abort();
		},
		hasTool( name ) {
			// A tool from the user's own MCP server is reported like a made-up one,
			// so its name stays out of telemetry.
			return (
				! isUserMcpTool( name ) &&
				( activeSession?.getAllTools().some( ( tool ) => tool.name === name ) ?? false )
			);
		},
		systemPrompt() {
			return systemPrompt;
		},
	};
}

// Synthesize a pi `agent_end` event with a single error assistant message.
// Used for failures the runtime catches before pi's own `agent_end` fires
// (abort during pre-flight, exceptions out of the agent loop). Downstream consumers read `stopReason`/`errorMessage` from
// the last assistant message — same path as a real run that errored.
function syntheticErrorAgentEnd(
	stopReason: 'error' | 'aborted',
	errorMessage: string
): AgentSessionEvent {
	return {
		type: 'agent_end',
		willRetry: false,
		messages: [
			{
				role: 'assistant',
				content: errorMessage ? [ { type: 'text', text: errorMessage } ] : [],
				api: 'anthropic-messages',
				provider: 'anthropic',
				model: '',
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason,
				errorMessage,
				timestamp: Date.now(),
			},
		],
	};
}

async function runAgentSessionTurn(
	config: ResolvedStudioAgentTurnConfig,
	controller: AbortController,
	setActiveSession: ( session: AgentSession | undefined ) => void
): Promise< void > {
	let session: AgentSession | undefined;
	let unsubscribe: ( () => void ) | undefined;
	const payloadGuardState: StudioToolPayloadGuardState = {};
	let heldReply: AgentSessionEvent[] = [];
	const state = config.subagentOf
		? shareSessionState( config.session, config.subagentOf.state )
		: getSessionState( config.host, config.session );
	try {
		session = await createStudioAgentSession( config, state, payloadGuardState );
		setActiveSession( session );
		const emit = ( event: AgentSessionEvent ) => {
			config.onEvent( event );
			if ( changesPreview( event ) ) {
				config.host.ui?.reloadPreview();
			}
		};
		// The end of each run is held until it is known whether the turn
		// continues: consumers wait for the turn's real end. So is a reply that
		// would end it, and what follows it, until Studio's checks of the turn.
		let heldEnd: Extract< AgentSessionEvent, { type: 'agent_end' } > | undefined;
		unsubscribe = session.subscribe( ( event ) => {
			updateStudioToolPayloadGuardState( event, payloadGuardState );
			if ( event.type === 'agent_end' && ! event.willRetry ) {
				heldEnd = event;
				return;
			}
			if ( heldReply.length || endsTurn( event ) ) {
				heldReply.push( event );
				return;
			}
			emit( event );
		} );
		const continueFrom = session.agent.transformContext;
		session.agent.transformContext = async ( messages, signal ) =>
			placeCallNotes(
				withoutContinuedReplies( continueFrom ? await continueFrom( messages, signal ) : messages )
			);

		if ( controller.signal.aborted ) {
			await session.abort();
			config.onEvent( syntheticErrorAgentEnd( 'aborted', '' ) );
			return;
		}

		const { writers, pendingWork } = state;
		let emptyStopContinues = 0;
		// What continues the turn after a run ends, if anything: a reply cut off
		// before it said anything, then the problems still open on the sites.
		const continuation = async (
			end: Extract< AgentSessionEvent, { type: 'agent_end' } >
		): Promise< { customType: string; content: string } | undefined > => {
			const lastAssistant = findLastAssistant( end.messages );
			if ( isEmptyStop( lastAssistant ) && emptyStopContinues < MAX_EMPTY_STOP_CONTINUES ) {
				emptyStopContinues++;
				return {
					customType: EMPTY_STOP_CONTINUE_TYPE,
					content: getEmptyStopContinuation( lastAssistant ),
				};
			}
			if ( lastAssistant?.stopReason !== 'stop' ) {
				return undefined;
			}
			await pendingWork.settle();
			// A block file the run wrote last is validated, and its lossless fix
			// saved, before the sites are checked, as on any later tool result.
			await state.blockValidation.settle( {
				mine: ( file ) => writers.ofFile( file ) === pendingWork,
			} );
			// The sites as the turn leaves them are the parent turn's to check.
			if ( config.subagentOf ) {
				const notes = studioMessage( 'notes', [ pendingWork.takeReports() ] );
				return notes ? { customType: OPEN_PROBLEMS_TYPE, content: notes } : undefined;
			}
			// The pages rendered after the last change: their problems are open
			// until fixed, and a verdict of none ends nothing.
			await state.renderCheck.settle();
			await state.renderCheck.takeReports();
			// The forms a visitor sends on what the turn changed, sent once: those
			// that store nowhere, or that will not send, are open until fixed.
			await state.formCheck.check().catch( () => undefined );
			const raised = await state.openProblems.raise();
			// The notes on the run's last calls, whose checks ran after their results.
			const notes = pendingWork.takeReports();
			// A problem a note here already says is not said again.
			const problems = withoutNoted( raised, notes );
			const content = [
				studioMessage( 'notes', [ notes ] ),
				problems.length ? describeOpenProblems( problems ) : undefined,
			]
				.filter( Boolean )
				.join( '\n' );
			// With nothing new, the turn ends: the invalid blocks it was told of and
			// left as they were are said once more, each once (OpenProblems.remind()).
			const reminder = content || describeStillInvalid( state.openProblems.remind() );
			return reminder ? { customType: OPEN_PROBLEMS_TYPE, content: reminder } : undefined;
		};

		await session.prompt( config.prompt, {
			expandPromptTemplates: false,
			source: 'rpc',
			images: config.images?.map( ( image ) => ( {
				type: 'image' as const,
				data: image.dataBase64,
				mimeType: image.mimeType,
			} ) ),
		} );
		for ( let end = heldEnd; end; end = heldEnd ) {
			heldEnd = undefined;
			const next = await continuation( end );
			const held = heldReply;
			heldReply = [];
			if ( ! next ) {
				held.forEach( emit );
				emit( end );
				break;
			}
			const rewinds = next.customType === OPEN_PROBLEMS_TYPE;
			held.forEach( ( event ) => emit( rewinds ? withoutReplyText( event ) : event ) );
			emit( { ...end, willRetry: true } );
			if ( controller.signal.aborted ) {
				config.onEvent( syntheticErrorAgentEnd( 'aborted', '' ) );
				break;
			}
			await session.sendCustomMessage( { ...next, display: false }, { triggerTurn: true } );
		}
		await pendingWork.settle();
	} catch ( error ) {
		heldReply.forEach( config.onEvent );
		const aborted = controller.signal.aborted;
		const message = aborted ? '' : error instanceof Error ? error.message : String( error );
		config.onEvent( syntheticErrorAgentEnd( aborted ? 'aborted' : 'error', message ) );
	} finally {
		unsubscribe?.();
		session?.dispose();
		setActiveSession( undefined );
		state.writers.release( state.pendingWork );
	}
}

async function createStudioAgentSession(
	config: ResolvedStudioAgentTurnConfig,
	state: SessionState,
	payloadGuardState: StudioToolPayloadGuardState
): Promise< AgentSession > {
	const { model } = config.ai;
	const visionEnabled = model.input.includes( 'image' );
	const confirm = createConfirmer( config.onConfirm ?? config.onAskUser );
	const [
		userInstructions,
		imageGenerationEnabled,
		activeSiteFacts,
		mcpServers,
		wpCliServer,
		localSites,
	] = await Promise.all( [
		readGlobalInstructions(),
		config.host.imageGenerator?.().then( Boolean ) ?? false,
		readActiveSiteFacts( config.host, config.activeSite ),
		readMcpServers( config.host.remoteHosts ),
		serveWpCli( config.host ),
		// With no active site, the turn's context names the user's sites.
		config.activeSite ? undefined : config.host.sites.all(),
	] );

	const {
		openProblems,
		pendingWork,
		blockValidation: blockValidationGate,
		renderCheck,
		writers,
	} = state;
	const sitePin = new SitePin( config.host, config.activeSite );
	const site = config.activeSite;
	const localSite = site && ! site.remote ? site.path : undefined;
	const siteNotes = createSiteNotes( config.host, {
		// The turn's context already states this turn's facts.
		stated: new Map( localSite ? [ [ path.resolve( localSite ), activeSiteFacts ] ] : [] ),
		gate: blockValidationGate,
		open: openProblems,
	} );
	// What a call changed on the request's sites, or on every local site until
	// the request has one, reported on its result.
	const siteChanges =
		config.subagentOf?.siteChanges ??
		new SiteChanges( config.host, openProblems, async () => {
			const sites = await config.host.sites.all();
			const pinned = sitePin.localSitePaths();
			return pinned.length
				? sites.filter( ( { path: sitePath } ) => pinned.includes( path.resolve( sitePath ) ) )
				: sites;
		} );
	const afterChecks = new AfterChecks( pendingWork );
	const fileViews = new FileViews();

	const userSkills = readUserSkills();
	const skillScope = new SkillToolScope( config.session, userSkills );
	let activateTools: () => void = () => {};
	const tools = buildAgentTools(
		config,
		{ state, siteChanges },
		// The site this request works on, once it has one: the active site, or
		// the one it created or first changed.
		async () => {
			const sitePath = sitePin.localRequestSite();
			if ( config.activeSite || ! sitePath ) {
				return config.activeSite;
			}
			const site = await config.host.sites.findByFolder( sitePath );
			return site && { ...site, running: await config.host.sites.isRunning( site ) };
		},
		imageGenerationEnabled,
		visionEnabled,
		wpCliServer,
		userSkills,
		( skillName ) => {
			skillScope.unlock( skillName );
			activateTools();
		}
	);
	const mcpTools = await createMcpTools(
		mcpServers,
		confirm,
		tools.map( ( tool ) => tool.name )
	);
	const systemPrompt = buildSystemPrompt( {
		environmentFacts: environmentFacts(),
		userInstructions,
	} );
	const turnContext = buildTurnContext( {
		shellDirectory: shellDirectory( config ),
		activeSite: config.activeSite,
		activeSiteFacts: activeSiteFacts.flat(),
		localSites,
	} );

	// The active site as the turn finds it, rendered while the model first
	// thinks. A subagent's changes are rendered after the parent's call.
	const renders = ! config.subagentOf;
	if ( renders && localSite && fs.existsSync( localSite ) ) {
		void renderCheck.seen( path.resolve( localSite ) ).catch( () => undefined );
	}
	const toolDefinitions = [ ...tools, ...mcpTools ].map( ( tool ) =>
		toToolDefinition( config.host, tool, payloadGuardState, pendingWork, blockValidationGate, {
			confirm,
			sitePin,
			siteNotes,
			siteChanges,
			afterChecks,
			renderCheck: renders ? renderCheck : undefined,
			formCheck: state.formCheck,
			openProblems,
			writers,
			fileViews,
		} )
	);
	const modelRuntime = await createModelRuntime( config.ai );
	const settingsManager = createSettingsManager();
	const { sitesRoot } = config.host;
	const resourceLoader = new DefaultResourceLoader( {
		cwd: sitesRoot,
		agentDir: sitesRoot,
		settingsManager,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPrompt,
		appendSystemPrompt: [],
	} );
	await resourceLoader.reload();

	const result = await createAgentSession( {
		cwd: sitesRoot,
		agentDir: sitesRoot,
		modelRuntime,
		model,
		thinkingLevel: 'medium',
		sessionManager: config.session,
		settingsManager,
		resourceLoader,
		customTools: toolDefinitions,
		tools: toolDefinitions.map( ( tool ) => tool.name ),
		sessionStartEvent: { type: 'session_start', reason: 'startup' },
	} );

	const allToolNames = toolDefinitions.map( ( tool ) => tool.name );
	activateTools = () =>
		result.session.setActiveToolsByName( skillScope.activeToolNames( allToolNames ) );
	activateTools();
	// The turn's context comes with its prompt when it differs from the one
	// the conversation last stated, also when compaction summed that one up.
	if ( turnContext !== lastTurnContext( result.session.messages ) ) {
		await result.session.sendCustomMessage(
			{ customType: TURN_CONTEXT_TYPE, content: turnContext, display: false },
			{ deliverAs: 'nextTurn' }
		);
	}
	return result.session;
}

const TURN_CONTEXT_TYPE = 'studio.turn_context';

function lastTurnContext( messages: AgentMessage[] ): string | undefined {
	for ( let index = messages.length - 1; index >= 0; index-- ) {
		const message = messages[ index ];
		if ( message.role === 'custom' && message.customType === TURN_CONTEXT_TYPE ) {
			return typeof message.content === 'string' ? message.content : undefined;
		}
	}
	return undefined;
}

// In-memory credential store so the runtime never reads or writes an auth.json
// on disk. Each turn registers its provider with the connection's credentials,
// so nothing needs to be persisted.
class InMemoryCredentialStore implements CredentialStore {
	private readonly credentials = new Map< string, Credential >();

	async read( providerId: string ): Promise< Credential | undefined > {
		return this.credentials.get( providerId );
	}

	async list(): Promise< readonly CredentialInfo[] > {
		return [ ...this.credentials.entries() ].map( ( [ providerId, credential ] ) => ( {
			providerId,
			type: credential.type,
		} ) );
	}

	async modify(
		providerId: string,
		fn: ( current: Credential | undefined ) => Promise< Credential | undefined >
	): Promise< Credential | undefined > {
		const next = await fn( this.credentials.get( providerId ) );
		if ( next ) {
			this.credentials.set( providerId, next );
		}
		return next;
	}

	async delete( providerId: string ): Promise< void > {
		this.credentials.delete( providerId );
	}
}

async function createModelRuntime( ai: AiConnection ): Promise< ModelRuntime > {
	const modelRuntime = await ModelRuntime.create( {
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
	} );
	modelRuntime.registerProvider( ai.piProvider, createProviderConfig( ai ) );
	return modelRuntime;
}

// pi (>= 0.78) parses `registerProvider` config values (apiKey, headers) as
// templates: a `$NAME` / `${NAME}` sequence is read as an environment-variable
// reference and a leading `!` is read as a shell command. API keys such as wpcom
// OAuth tokens are random strings that can contain `$` followed by a name-like
// sequence, so pi resolves that fragment to an undefined env var and treats the
// provider as unauthenticated ("No API key found for studio-wpcom."). Escape the
// key so pi treats it as a literal: `$` -> `$$`, and a leading `!` -> `$!`.
function escapePiConfigValue( value: string ): string {
	const dollarEscaped = value.replace( /\$/g, () => '$$' );
	return dollarEscaped.startsWith( '!' ) ? `$${ dollarEscaped }` : dollarEscaped;
}

// Each provider only needs pi's stock streaming for its model's API; the
// registration exists to run it through the connection's stream.
function createProviderConfig( ai: AiConnection ): ProviderConfigInput {
	const { apiKey, headers, model } = ai;
	return {
		baseUrl: model.baseUrl,
		apiKey: escapePiConfigValue( apiKey ),
		api: model.api,
		headers,
		streamSimple: createConnectionStream( ai ),
		models: [
			{
				id: model.id,
				name: model.name,
				api: model.api,
				baseUrl: model.baseUrl,
				reasoning: model.reasoning,
				input: model.input,
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				headers,
				compat: model.compat,
			},
		],
	};
}

function createSettingsManager(): SettingsManager {
	return SettingsManager.inMemory(
		{
			defaultThinkingLevel: 'high',
			compaction: STUDIO_COMPACTION_SETTINGS,
		},
		{ projectTrusted: false }
	);
}

function getStudioWpSpawnHook( wpCliServer: string | undefined ) {
	const cliPath = process.env.STUDIO_CLI_BIN ?? path.join( import.meta.dirname, 'main.mjs' );
	return agentShell(
		ensureStudioShimDirectory( getStudioShims( process.execPath, cliPath ) ),
		wpCliServer
	);
}

// Bash starts in the active local site's folder, where most commands run and
// where `studio wp` finds the site (getSiteContainingFolder() in cli/commands/wp.ts).
function shellDirectory( config: ResolvedStudioAgentTurnConfig ): string {
	const site = config.activeSite;
	return site && ! site.remote && fs.existsSync( site.path ) ? site.path : config.host.sitesRoot;
}

function buildAgentTools(
	config: ResolvedStudioAgentTurnConfig,
	checks: SubagentParent,
	requestSite: () => Promise< SiteInfo | null | undefined >,
	imageGenerationEnabled: boolean,
	visionEnabled: boolean,
	wpCliServer: string | undefined,
	userSkills: Skill[],
	onSkillLoad: ( skillName: string ) => void
): AgentToolAny[] {
	const { host } = config;
	// pi's tools are registered under Studio's names.
	const renameTool = < S extends TSchema >( tool: AgentTool< S >, name: string ): AgentTool< S > =>
		( { ...tool, name, label: name } ) as AgentTool< S >;

	const { sitesRoot } = host;
	const piTools: AgentToolAny[] = [
		renameTool(
			visionEnabled
				? createReadTool( sitesRoot )
				: withTextOnlyImages( createReadTool( sitesRoot ) ),
			'Read'
		),
		renameTool( createWriteTool( sitesRoot ), 'Write' ),
		renameTool( withStringEdits( createEditTool( sitesRoot ) ), 'Edit' ),
		renameTool(
			withDefaultTimeout(
				createBashTool( shellDirectory( config ), {
					spawnHook: getStudioWpSpawnHook( wpCliServer ),
				} )
			),
			'Bash'
		),
		renameTool( createGrepTool( sitesRoot ), 'Grep' ),
		renameTool( createFindTool( sitesRoot ), 'Glob' ),
		renameTool( createLsTool( sitesRoot ), 'Ls' ),
	];
	const conversationTools = resolveConversationTools( host, {
		shell: true,
		imageGeneration: imageGenerationEnabled,
		visionEnabled,
		onAskUser: config.onAskUser,
		userSkills,
		onSkillLoad: ( skill ) => onSkillLoad( skill.name ),
		definitions: nodeStudioToolDefinitions,
	} ) as unknown as AgentToolAny[];
	// A subagent's turn is this turn's, from a fresh session and with nobody to
	// ask: confirmations still reach the user. Its active site is this
	// request's, so it starts knowing the site as it is now.
	const subagentTool: AgentToolAny[] = config.subagentOf
		? []
		: [
				createSubagentTool( async ( task, onEvent ) =>
					runStudioAgentTurn( host, {
						prompt: task,
						session: SessionManager.inMemory( sitesRoot ),
						ai: config.ai,
						activeSite: await requestSite(),
						onConfirm: config.onConfirm ?? config.onAskUser,
						onEvent,
						subagentOf: checks,
					} )
				),
		  ];
	return [ ...conversationTools, ...subagentTool, ...piTools ];
}
