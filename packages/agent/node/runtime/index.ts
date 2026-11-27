import fs from 'fs';
import os from 'os';
import path from 'path';
import { type AgentTool } from '@earendil-works/pi-agent-core';
import {
	isContextOverflow,
	type Credential,
	type CredentialInfo,
	type CredentialStore,
} from '@earendil-works/pi-ai';
import { MIN_ANSWER_TOKENS } from '@earendil-works/pi-ai/api/simple-options';
import { estimateTextTokens } from '@earendil-works/pi-ai/utils/estimate';
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
	type SessionManager,
	type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { readSkillsForAgent } from '@studio/common/lib/global-skills';
import { getAiTracksIdentity } from '@studio/common/lib/tracks-identity';
import { type UserSkill } from '@studio/common/lib/user-skills';
import { getSiteEmailDirectory } from '@studio/common/sites/site-email';
import { type TSchema } from 'typebox';
import { withDesignSystemPreview } from '@studio/agent/node/chat-artifacts';
import { getFileToolPrompt } from '@studio/agent/node/file-tool-prompts';
import { readGlobalInstructions } from '@studio/agent/node/global-instructions';
import { createConnectionStream } from '@studio/agent/node/models';
import {
	getPendingWork,
	runWithPendingWork,
	type PendingWork,
} from '@studio/agent/node/pending-work';
import { createResultNotes } from '@studio/agent/node/result-notes';
import { findActiveSiteDesign } from '@studio/agent/node/site-selection';
import { buildSystemPrompt, type ToolPromptContribution } from '@studio/agent/node/system-prompt';
import { assertToolCallAllowed } from '@studio/agent/node/tool-safety';
import { resolveConversationTools } from '@studio/agent/node/tools';
import {
	findLastAssistant,
	getEmptyStopContinuation,
	isEmptyStop,
	MAX_EMPTY_STOP_CONTINUES,
} from '@studio/agent/protocol/session-events';
import { DEFAULT_THINKING_LEVEL } from '@studio/agent/protocol/thinking';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { AskUserHandler, SiteInfo } from '@studio/agent/node/types';
import type { StudioChatImage } from '@studio/agent/protocol/chat-images';
import type { AiConnection, ThinkingLevel } from '@studio/providers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;
type ProviderConfigInput = Parameters< ModelRuntime[ 'registerProvider' ] >[ 1 ];

const EMPTY_STOP_CONTINUE_TYPE = 'studio.empty_stop_continue';
const STUDIO_COMPACTION_SETTINGS = {
	enabled: true,
	reserveTokens: 16_384,
	keepRecentTokens: 20_000,
};

// What pi leaves out of the window for the reply: its safety margin, which it doesn't export, and
// the smallest reply.
const REPLY_TOKENS = 4096 + MIN_ANSWER_TOKENS;

/**
 * The compaction settings for an exact window, given the tokens the system prompt and tools take:
 * the conversation's share of what a request holds sets them where today's sizes don't fit, so
 * compaction starts once the conversation fills half its share, and keeps a quarter of it, so a
 * request after compacting still fits.
 */
function getCompactionSettings( contextWindow: number, baseTokens: number ) {
	const share = Math.max( 0, contextWindow - baseTokens - REPLY_TOKENS );
	return {
		...STUDIO_COMPACTION_SETTINGS,
		reserveTokens: Math.min(
			STUDIO_COMPACTION_SETTINGS.reserveTokens,
			Math.floor( share / 2 ) + REPLY_TOKENS
		),
		keepRecentTokens: Math.min(
			STUDIO_COMPACTION_SETTINGS.keepRecentTokens,
			Math.max( 1, Math.floor( share / 4 ) )
		),
	};
}

type AgentEndEvent = Extract< AgentSessionEvent, { type: 'agent_end' } >;

/**
 * On a connection whose window is exact, a turn that ends on a context overflow ends with the
 * connection's words, in place of pi's or the server's. pi ends a run on an overflow before it
 * compacts the conversation to retry it, so that end isn't final until the compaction is: a retry
 * ends the turn itself, a compaction that fails for another reason, such as a server that stopped
 * answering, ends the turn with that failure, and one the user stopped ends it as interrupted.
 */
function createOverflowEnding( ai: AiConnection ) {
	const words = ai.exactContextWindow?.overflowMessage;
	let pending: AgentEndEvent | undefined;
	let compacting = false;

	// The overflowed run's end, final: with `errorMessage`, or as interrupted without one.
	const end = ( event: AgentEndEvent, errorMessage?: string ): AgentEndEvent => {
		const last = findLastAssistant( event.messages );
		const ending =
			errorMessage === undefined
				? { stopReason: 'aborted' as const, errorMessage: undefined }
				: { errorMessage };
		return {
			...event,
			willRetry: false,
			messages: event.messages.map( ( message ) =>
				message === last ? { ...last, ...ending } : message
			),
		};
	};

	return {
		handle( event: AgentSessionEvent ): AgentSessionEvent[] {
			if ( ! words ) {
				return [ event ];
			}
			if ( event.type === 'agent_end' && ! event.willRetry ) {
				const last = findLastAssistant( event.messages );
				if ( last && isContextOverflow( last ) ) {
					pending = event;
					return [ { ...event, willRetry: true } ];
				}
			}
			if ( event.type === 'compaction_start' && event.reason === 'overflow' ) {
				compacting = true;
			}
			if ( event.type !== 'compaction_end' || event.reason !== 'overflow' || ! pending ) {
				return [ event ];
			}
			const overflowed = pending;
			const summaryFailed = compacting;
			compacting = false;
			pending = undefined;
			if ( event.willRetry ) {
				return [ event ];
			}
			if ( event.aborted ) {
				return [ event, end( overflowed ) ];
			}
			const last = findLastAssistant( overflowed.messages )!;
			const failure =
				summaryFailed &&
				event.errorMessage &&
				! isContextOverflow( { ...last, errorMessage: event.errorMessage } )
					? event.errorMessage
					: words;
			return [ { ...event, errorMessage: undefined }, end( overflowed, failure ) ];
		},
		/** The end of a turn pi left on an overflow without compacting it, or that was interrupted. */
		flush( interrupted: boolean ): AgentSessionEvent[] {
			const overflowed = pending;
			pending = undefined;
			return overflowed ? [ end( overflowed, interrupted ? undefined : words ) ] : [];
		},
	};
}

export interface StudioAgentTurnConfig {
	prompt: string;
	images?: StudioChatImage[];
	session: SessionManager;
	// The model to run on, as the provider serving it connects to it.
	ai: AiConnection;
	// How much the model thinks; without it, Studio's default.
	thinking?: ThinkingLevel;
	activeSite?: SiteInfo | null;
	onAskUser?: AskUserHandler;
	onEvent: ( event: AgentSessionEvent ) => void;
}

interface ResolvedStudioAgentTurnConfig extends StudioAgentTurnConfig {
	host: StudioAgentHost;
}

export interface StudioAgentTurnHandle {
	result: Promise< void >;
	interrupt(): Promise< void >;
	/** Whether `name` is one of the turn's registered tools, not a name the model made up. */
	hasTool( name: string ): boolean;
}

export function runStudioAgentTurn(
	host: StudioAgentHost,
	config: StudioAgentTurnConfig
): StudioAgentTurnHandle {
	const controller = new AbortController();
	let activeSession: AgentSession | undefined;
	const resolvedConfig: ResolvedStudioAgentTurnConfig = { ...config, host };

	if ( ! fs.existsSync( host.sitesRoot ) ) {
		fs.mkdirSync( host.sitesRoot, { recursive: true } );
	}

	const result = runAgentSessionTurn( resolvedConfig, controller, ( session ) => {
		activeSession = session;
	} );

	return {
		result,
		async interrupt() {
			controller.abort();
			await activeSession?.abort();
		},
		hasTool( name ) {
			return activeSession?.getAllTools().some( ( tool ) => tool.name === name ) ?? false;
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
	try {
		session = await createStudioAgentSession( config );
		setActiveSession( session );
		let emptyStopContinues = 0;
		let continueAfterEmptyStop = false;
		let continuation = '';
		const overflowEnding = createOverflowEnding( config.ai );
		unsubscribe = session.subscribe( ( event ) => {
			if (
				event.type === 'agent_end' &&
				! event.willRetry &&
				emptyStopContinues < MAX_EMPTY_STOP_CONTINUES
			) {
				const lastAssistant = findLastAssistant( event.messages );
				if ( isEmptyStop( lastAssistant ) ) {
					// Not final: consumers wait for the turn's real end.
					continueAfterEmptyStop = true;
					continuation = getEmptyStopContinuation( lastAssistant );
					config.onEvent( { ...event, willRetry: true } );
					return;
				}
			}
			overflowEnding.handle( event ).forEach( ( item ) => config.onEvent( item ) );
		} );

		if ( controller.signal.aborted ) {
			await session.abort();
			config.onEvent( syntheticErrorAgentEnd( 'aborted', '' ) );
			return;
		}

		await session.prompt( config.prompt, {
			expandPromptTemplates: false,
			source: 'rpc',
			images: config.images?.map( ( image ) => ( {
				type: 'image' as const,
				data: image.dataBase64,
				mimeType: image.mimeType,
			} ) ),
		} );
		while ( continueAfterEmptyStop ) {
			continueAfterEmptyStop = false;
			if ( controller.signal.aborted ) {
				config.onEvent( syntheticErrorAgentEnd( 'aborted', '' ) );
				break;
			}
			emptyStopContinues++;
			await session.sendCustomMessage(
				{
					customType: EMPTY_STOP_CONTINUE_TYPE,
					content: continuation,
					display: false,
				},
				{ triggerTurn: true }
			);
		}
		overflowEnding.flush( controller.signal.aborted ).forEach( ( item ) => config.onEvent( item ) );
		await getPendingWork( config.session ).settle();
	} catch ( error ) {
		const aborted = controller.signal.aborted;
		const message = aborted ? '' : error instanceof Error ? error.message : String( error );
		config.onEvent( syntheticErrorAgentEnd( aborted ? 'aborted' : 'error', message ) );
	} finally {
		unsubscribe?.();
		session?.dispose();
		setActiveSession( undefined );
	}
}

async function createStudioAgentSession(
	config: ResolvedStudioAgentTurnConfig
): Promise< AgentSession > {
	const { model } = config.ai;
	const visionEnabled = model.input.includes( 'image' );
	const [ userInstructions, imageGenerationEnabled, designPath, userSkills ] = await Promise.all( [
		readGlobalInstructions(),
		config.host.imageGenerator?.().then( Boolean ) ?? false,
		findActiveSiteDesign( config.activeSite ),
		// A WordPress.com site has no folder of its own skills, only the global ones.
		readSkillsForAgent(
			config.activeSite && ! config.activeSite.remote ? config.activeSite.path : undefined
		),
	] );

	const tools = buildAgentTools( config, imageGenerationEnabled, visionEnabled, userSkills );
	const systemPrompt = buildSystemPrompt( {
		userInstructions,
		tools: tools.map( toolPromptContribution ),
		activeSite: config.activeSite,
		activeSiteDesignPath: designPath,
		activeSiteEmailPath: config.activeSite?.id
			? getSiteEmailDirectory( config.activeSite.id )
			: undefined,
	} );

	const pendingWork = getPendingWork( config.session );
	const site = config.activeSite;
	const notes = createResultNotes();
	const resultNotes =
		site && ! site.remote ? ( text: string ) => notes( site.path, text ) : undefined;
	const toolDefinitions = tools.map( ( tool ) =>
		toToolDefinition( config.host, tool, pendingWork, resultNotes )
	);
	const modelRuntime = await createModelRuntime( config.ai );
	const settingsManager = createSettingsManager(
		config.ai.exactContextWindow
			? getCompactionSettings(
					config.ai.model.contextWindow,
					estimateTextTokens(
						systemPrompt +
							JSON.stringify(
								toolDefinitions.map( ( { name, description, parameters } ) => ( {
									name,
									description,
									parameters,
								} ) )
							)
					)
			  )
			: STUDIO_COMPACTION_SETTINGS
	);
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
		thinkingLevel: config.thinking ?? DEFAULT_THINKING_LEVEL,
		sessionManager: config.session,
		settingsManager,
		resourceLoader,
		customTools: toolDefinitions,
		tools: toolDefinitions.map( ( tool ) => tool.name ),
		sessionStartEvent: { type: 'session_start', reason: 'startup' },
	} );

	return result.session;
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

function createSettingsManager( compaction: typeof STUDIO_COMPACTION_SETTINGS ): SettingsManager {
	return SettingsManager.inMemory(
		{
			defaultThinkingLevel: 'high',
			compaction,
		},
		{ projectTrusted: false }
	);
}

// pi's tools declare a prompt snippet and so do Studio's (see define-tool.ts);
// the AgentTool type does not carry it, hence the cast.
type ToolPromptFields = { promptSnippet?: string };

function toolPromptContribution( tool: AgentToolAny ): ToolPromptContribution {
	return { name: tool.name, promptSnippet: ( tool as ToolPromptFields ).promptSnippet };
}

// Where pi's file tools put a path: without a leading `@`, with `~` expanded.
function resolveToolPath( { sitesRoot }: StudioAgentHost, file: string ): string {
	const withoutAt = file.replace( /^@/, '' );
	const expanded =
		withoutAt === '~' || withoutAt.startsWith( '~/' )
			? path.join( os.homedir(), withoutAt.slice( 1 ) )
			: withoutAt;
	return path.resolve( sitesRoot, expanded );
}

function toToolDefinition(
	host: StudioAgentHost,
	tool: AgentToolAny,
	pendingWork: PendingWork,
	resultNotes?: ( text: string ) => Promise< string >
): ToolDefinition {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		prepareArguments: tool.prepareArguments,
		executionMode: tool.executionMode,
		promptSnippet: ( tool as ToolPromptFields ).promptSnippet,
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			await assertToolCallAllowed( tool.name, params, host, ( file ) =>
				resolveToolPath( host, file )
			);
			return runWithPendingWork(
				{
					settles: ( tool as { settlesPendingWork?: boolean } ).settlesPendingWork,
					pendingWork,
					resultNotes,
				},
				() => tool.execute( toolCallId, params, signal, onUpdate )
			);
		},
	};
}

function buildAgentTools(
	config: ResolvedStudioAgentTurnConfig,
	imageGenerationEnabled: boolean,
	visionEnabled: boolean,
	userSkills: UserSkill[]
): AgentToolAny[] {
	const { host } = config;

	// pi's tools are registered under Studio's names; the prompt text for them
	// is Studio's too (file-tool-prompts.ts), so nothing of pi's wording leaks.
	const renameTool = < S extends TSchema >( tool: AgentTool< S >, name: string ): AgentTool< S > =>
		( { ...tool, name, label: name, ...getFileToolPrompt( name ) } ) as AgentTool< S >;

	const { sitesRoot } = host;
	const piTools: AgentToolAny[] = [
		renameTool( createReadTool( sitesRoot ), 'Read' ),
		withDesignSystemPreview( renameTool( createWriteTool( sitesRoot ), 'Write' ), host ),
		withDesignSystemPreview( renameTool( createEditTool( sitesRoot ), 'Edit' ), host ),
		renameTool( createBashTool( sitesRoot ), 'Bash' ),
		renameTool( createGrepTool( sitesRoot ), 'Grep' ),
		renameTool( createFindTool( sitesRoot ), 'Glob' ),
		renameTool( createLsTool( sitesRoot ), 'Ls' ),
	];
	const conversationTools = resolveConversationTools( host, {
		imageGeneration: imageGenerationEnabled,
		visionEnabled,
		onAskUser: config.onAskUser,
		tracks: getAiTracksIdentity( config.session.getSessionId() ),
		userSkills,
	} ) as unknown as AgentToolAny[];
	return [ ...conversationTools, ...piTools ];
}
