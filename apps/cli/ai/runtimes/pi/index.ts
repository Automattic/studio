import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { type AgentTool } from '@earendil-works/pi-agent-core';
import { type Model, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import {
	stream as streamAnthropic,
	type AnthropicEffort,
	type AnthropicOptions,
} from '@earendil-works/pi-ai/api/anthropic-messages';
import {
	AuthStorage,
	createAgentSession,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	DefaultResourceLoader,
	ModelRegistry,
	SettingsManager,
	type AgentSession,
	type AgentSessionEvent,
	type SessionManager,
	type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
	DEFAULT_MODEL,
	getAiModelFamily,
	getAiModelThinking,
	type AiModelFamily,
	type AiModelId,
} from '@studio/common/ai/models';
import { type AiResponseLength } from '@studio/common/ai/response-length';
import {
	getSiteRuntime,
	SITE_RUNTIME_NATIVE_PHP,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { getAiPayloadsPath, getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { createResponseLengthExtension } from 'cli/ai/extensions/response-length';
import {
	createToolPermissionsExtension,
	type PermissionRequestHandler,
} from 'cli/ai/extensions/tool-permissions';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { resolveStudioToolDefinitions, withChatArtifactEmission } from 'cli/ai/tools';
import { createAskUserQuestionTool } from 'cli/ai/tools/ask-user-question';
import { createSiteTool } from 'cli/ai/tools/create-site';
import { pullSiteTool } from 'cli/ai/tools/pull-site';
import { createSkillTool } from 'cli/ai/tools/skill';
import { takeScreenshotTool } from 'cli/ai/tools/take-screenshot';
import { createWpcomRequestTool } from 'cli/ai/tools/wpcom-request';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { stripStaleImagesFromContext } from './strip-stale-images';
import {
	getIncompleteToolCallReason,
	getPayloadLimitDescription,
	getPayloadLimitViolation,
	type StudioToolPayloadGuardState,
	updateStudioToolPayloadGuardState,
} from './tool-safety';
import type { StudioChatImage } from '@studio/common/ai/chat-images';
import type { AskUserHandler, SiteInfo } from 'cli/ai/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;
type StudioModel = Model< 'openai-completions' > | Model< 'anthropic-messages' >;
type ProviderConfigInput = Parameters< ModelRegistry[ 'registerProvider' ] >[ 1 ];

const STUDIO_WPCOM_ANTHROPIC_PROVIDER = 'studio-wpcom-anthropic';
const STUDIO_AGENT_DIR = STUDIO_SITES_ROOT;
const STUDIO_WPCOM_BODY_FILES_ROOT = getConfigDirectory();
const STUDIO_WPCOM_BODY_FILES_DIR = getAiPayloadsPath();
const STUDIO_COMPACTION_SETTINGS = {
	enabled: true,
	reserveTokens: 16_384,
	keepRecentTokens: 20_000,
};

export interface StudioAgentTurnConfig {
	prompt: string;
	images?: StudioChatImage[];
	session: SessionManager;
	env?: Record< string, string >;
	model?: AiModelId;
	responseLength?: AiResponseLength;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: AskUserHandler;
	// Blocking confirmation for gated tools (see the tool-permissions
	// extension). When absent, gated tools fail closed instead of running.
	onRequestPermission?: PermissionRequestHandler;
	onEvent: ( event: AgentSessionEvent ) => void;
}

interface ResolvedStudioAgentTurnConfig extends StudioAgentTurnConfig {
	env: Record< string, string >;
	model: AiModelId;
}

export interface StudioAgentTurnHandle {
	result: Promise< void >;
	interrupt(): Promise< void >;
}

export function runStudioAgentTurn( config: StudioAgentTurnConfig ): StudioAgentTurnHandle {
	const controller = new AbortController();
	let activeSession: AgentSession | undefined;
	const resolvedConfig: ResolvedStudioAgentTurnConfig = {
		...config,
		env: config.env ?? { ...( process.env as Record< string, string > ) },
		model: config.model ?? DEFAULT_MODEL,
	};

	if ( ! fs.existsSync( STUDIO_SITES_ROOT ) ) {
		fs.mkdirSync( STUDIO_SITES_ROOT, { recursive: true } );
	}
	if ( resolvedConfig.activeSite?.remote ) {
		fs.mkdirSync( STUDIO_WPCOM_BODY_FILES_DIR, { recursive: true } );
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
	};
}

interface ResolvedCredentials {
	apiKey: string;
	baseURL: string;
	extraHeaders?: Record< string, string >;
	useBearerAuth: boolean;
}

function resolveCredentials(
	family: AiModelFamily,
	env: Record< string, string >
): { ok: true; creds: ResolvedCredentials } | { ok: false; reason: string } {
	if ( family === 'openai' ) {
		const apiKey = env.OPENAI_API_KEY?.trim();
		if ( ! apiKey ) {
			return {
				ok: false,
				reason:
					'OpenAI provider selected but OPENAI_API_KEY is not set. On the WordPress.com provider this means the wpcom access token is missing — run /login to authenticate.',
			};
		}
		const baseURL = env.OPENAI_BASE_URL?.trim();
		if ( ! baseURL ) {
			return { ok: false, reason: 'OPENAI_BASE_URL not set — cannot route to wpcom proxy.' };
		}
		return {
			ok: true,
			creds: {
				apiKey,
				baseURL,
				extraHeaders: parseJsonHeaderEnv( env.STUDIO_OPENAI_DEFAULT_HEADERS ),
				useBearerAuth: false,
			},
		};
	}

	const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim();
	const apiKey = env.ANTHROPIC_API_KEY?.trim();
	const credential = authToken ?? apiKey;
	if ( ! credential ) {
		return {
			ok: false,
			reason:
				'Anthropic provider selected but neither ANTHROPIC_AUTH_TOKEN nor ANTHROPIC_API_KEY is set. On the WordPress.com provider this means the wpcom access token is missing — run /login to authenticate. Otherwise switch to the Anthropic · API key provider with /provider and save a key.',
		};
	}
	const baseURL = env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com';
	return {
		ok: true,
		creds: {
			apiKey: credential,
			baseURL,
			extraHeaders: parseAnthropicHeaderEnv( env.ANTHROPIC_CUSTOM_HEADERS ),
			useBearerAuth: Boolean( authToken ),
		},
	};
}

// Synthesize a pi `agent_end` event with a single error assistant message.
// Used for failures the runtime catches before pi's own `agent_end` fires
// (missing credentials, abort during pre-flight, exceptions out of the
// agent loop). Downstream consumers read `stopReason`/`errorMessage` from
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
	const family = getAiModelFamily( config.model );
	const resolved = resolveCredentials( family, config.env );
	if ( ! resolved.ok ) {
		config.onEvent( syntheticErrorAgentEnd( 'error', resolved.reason ) );
		return;
	}

	let session: AgentSession | undefined;
	let unsubscribe: ( () => void ) | undefined;
	const payloadGuardState: StudioToolPayloadGuardState = {};
	try {
		session = await createStudioAgentSession( config, family, resolved.creds, payloadGuardState );
		setActiveSession( session );
		unsubscribe = session.subscribe( ( event ) => {
			updateStudioToolPayloadGuardState( event, payloadGuardState );
			config.onEvent( event );
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

// Resolve the runtime of the active local site so the system prompt can drop
// Playground-specific WP-CLI guidance for native PHP sites. The active site
// (a SiteInfo) doesn't carry the runtime, so look it up by path in the CLI
// config. Falls back to native-php (the default runtime) for unknown, remote,
// or unreadable sites.
async function resolveActiveSiteRuntime(
	activeSite: SiteInfo | null | undefined
): Promise< SiteRuntime > {
	if ( ! activeSite || activeSite.remote || ! activeSite.path ) {
		return SITE_RUNTIME_NATIVE_PHP;
	}
	try {
		const site = await getSiteByFolder( activeSite.path );
		return getSiteRuntime( site );
	} catch {
		return SITE_RUNTIME_NATIVE_PHP;
	}
}

async function createStudioAgentSession(
	config: ResolvedStudioAgentTurnConfig,
	family: AiModelFamily,
	creds: ResolvedCredentials,
	payloadGuardState: StudioToolPayloadGuardState
): Promise< AgentSession > {
	const model = buildModel( config.model, family, creds );
	const isRemoteSite = Boolean( config.activeSite?.remote && config.activeSite?.wpcomSiteId );
	const remoteSession = config.env.STUDIO_REMOTE_SESSION === '1';
	const chatArtifactsEnabled = typeof process.send === 'function';

	const systemPrompt = buildSystemPrompt(
		isRemoteSite
			? {
					remoteSite: {
						name: config.activeSite!.name,
						url: config.activeSite!.url ?? '',
						id: config.activeSite!.wpcomSiteId!,
					},
					remoteSession,
			  }
			: {
					chatArtifactsEnabled,
					remoteSession,
					runtime: await resolveActiveSiteRuntime( config.activeSite ),
			  }
	);

	const tools = buildAgentTools( config, chatArtifactsEnabled, remoteSession );
	const toolDefinitions = tools.map( ( tool ) => toToolDefinition( tool, payloadGuardState ) );
	const { authStorage, modelRegistry } = createModelRegistry( model, family, creds );
	const settingsManager = createSettingsManager( config.env );
	const resourceLoader = new DefaultResourceLoader( {
		cwd: STUDIO_SITES_ROOT,
		agentDir: STUDIO_AGENT_DIR,
		settingsManager,
		// Inline factories load even with `noExtensions` — that flag only
		// disables filesystem extension discovery.
		extensionFactories: [
			createResponseLengthExtension( config.responseLength ),
			createToolPermissionsExtension( { onRequestPermission: config.onRequestPermission } ),
		],
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
		cwd: STUDIO_SITES_ROOT,
		agentDir: STUDIO_AGENT_DIR,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: 'medium',
		sessionManager: config.session,
		settingsManager,
		resourceLoader,
		customTools: toolDefinitions,
		tools: toolDefinitions.map( ( tool ) => tool.name ),
		sessionStartEvent: { type: 'session_start', reason: 'startup' },
	} );

	return result.session;
}

function buildModel(
	modelId: AiModelId,
	family: AiModelFamily,
	creds: ResolvedCredentials
): StudioModel {
	const baseUrl = creds.baseURL.replace( /\/+$/, '' );
	const common = {
		id: modelId,
		name: modelId,
		baseUrl,
		input: [ 'text' as const, 'image' as const ],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		...( creds.extraHeaders ? { headers: creds.extraHeaders } : {} ),
	};

	if ( family === 'openai' ) {
		return {
			...common,
			api: 'openai-completions',
			provider: 'openai',
			reasoning: false,
			contextWindow: 200_000,
			maxTokens: 16_384,
		};
	}
	const thinking = getAiModelThinking( modelId );
	return {
		...common,
		api: 'anthropic-messages',
		provider: creds.useBearerAuth ? STUDIO_WPCOM_ANTHROPIC_PROVIDER : 'anthropic',
		reasoning: thinking !== 'none',
		// Adaptive-thinking models (Sonnet 5, Opus 4.8) reject budget-based
		// thinking requests with a 400 — they only accept
		// `thinking: {type: "adaptive"}`. This compat flag makes pi-ai (and our
		// mirror in `resolveThinkingOptions`) emit the adaptive shape.
		...( thinking === 'adaptive' ? { compat: { forceAdaptiveThinking: true } } : {} ),
		contextWindow: 200_000,
		// On budget-thinking models, thinkingLevel 'high' reserves ~16384 of this
		// budget for extended thinking (see adjustMaxTokensForThinking in pi-ai);
		// keep enough headroom for visible output so single tool calls can emit a
		// full-page HTML payload. Adaptive thinking reserves no fixed budget.
		maxTokens: 32_000,
	};
}

function createModelRegistry(
	model: StudioModel,
	family: AiModelFamily,
	creds: ResolvedCredentials
): { authStorage: AuthStorage; modelRegistry: ModelRegistry } {
	const authStorage = AuthStorage.inMemory();
	const modelRegistry = ModelRegistry.inMemory( authStorage );

	if ( family === 'anthropic' && creds.useBearerAuth ) {
		modelRegistry.registerProvider(
			STUDIO_WPCOM_ANTHROPIC_PROVIDER,
			createWpcomAnthropicProviderConfig( model as Model< 'anthropic-messages' >, creds )
		);
		return { authStorage, modelRegistry };
	}

	authStorage.setRuntimeApiKey( family, creds.apiKey );
	return { authStorage, modelRegistry };
}

// pi (>= 0.78) parses `registerProvider` config values (apiKey, headers) as
// templates: a `$NAME` / `${NAME}` sequence is read as an environment-variable
// reference and a leading `!` is read as a shell command. wpcom OAuth tokens are
// random strings that can contain `$` followed by a name-like sequence, so pi
// resolves that fragment to an undefined env var and treats the provider as
// unauthenticated ("No API key found for studio-wpcom-anthropic."). Escape the
// token so pi treats it as a literal: `$` -> `$$`, and a leading `!` -> `$!`.
function escapePiConfigValue( value: string ): string {
	const dollarEscaped = value.replace( /\$/g, () => '$$' );
	return dollarEscaped.startsWith( '!' ) ? `$${ dollarEscaped }` : dollarEscaped;
}

// pi's `streamSimple` wrapper (api/anthropic-messages) maps the simple
// `reasoning` level to the low-level thinking options — but it builds its own
// SDK client, which would drop the wpcom bearer-auth client we inject below.
// We call the low-level `streamAnthropic` instead, so we must mirror that
// mapping here or extended thinking is silently never requested (the
// low-level API ignores `reasoning`). Budgets match pi-ai's
// `adjustMaxTokensForThinking` defaults (not exported).
const THINKING_BUDGETS: Record< string, number > = {
	minimal: 1024,
	low: 2048,
	medium: 8192,
	high: 16384,
};
const MIN_VISIBLE_OUTPUT_TOKENS = 1024;

// Mirrors pi-ai's `mapThinkingLevelToEffort` (not exported): an explicit
// `thinkingLevelMap` entry wins, otherwise map the level to the closest
// effort tier.
function mapThinkingLevelToEffort(
	model: Model< 'anthropic-messages' >,
	level: NonNullable< SimpleStreamOptions[ 'reasoning' ] >
): AnthropicEffort {
	const mapped = model.thinkingLevelMap?.[ level ];
	if ( typeof mapped === 'string' ) {
		// ThinkingLevelMap values are plain strings; pi-ai forwards them as-is.
		return mapped as AnthropicEffort;
	}
	switch ( level ) {
		case 'minimal':
		case 'low':
			return 'low';
		case 'medium':
			return 'medium';
		default:
			return 'high';
	}
}

function resolveThinkingOptions(
	model: Model< 'anthropic-messages' >,
	options?: SimpleStreamOptions
): {
	thinkingEnabled: boolean;
	thinkingBudgetTokens?: number;
	maxTokens?: number;
	effort?: AnthropicEffort;
} {
	const reasoning = options?.reasoning;
	if ( ! reasoning || ! model.reasoning ) {
		return { thinkingEnabled: false };
	}
	// Adaptive-thinking models take an effort level instead of a token budget;
	// sending `budget_tokens` to them is a 400. No max-tokens adjustment needed
	// since adaptive thinking reserves no fixed budget.
	if ( model.compat?.forceAdaptiveThinking === true ) {
		return { thinkingEnabled: true, effort: mapThinkingLevelToEffort( model, reasoning ) };
	}
	const level = reasoning === 'xhigh' ? 'high' : reasoning;
	let thinkingBudget = THINKING_BUDGETS[ level ] ?? THINKING_BUDGETS.high;
	const baseMaxTokens = options?.maxTokens;
	const maxTokens =
		baseMaxTokens === undefined
			? model.maxTokens
			: Math.min( baseMaxTokens + thinkingBudget, model.maxTokens );
	if ( maxTokens <= thinkingBudget ) {
		thinkingBudget = Math.max( 0, maxTokens - MIN_VISIBLE_OUTPUT_TOKENS );
	}
	return { thinkingEnabled: true, thinkingBudgetTokens: thinkingBudget, maxTokens };
}

function createWpcomAnthropicProviderConfig(
	model: Model< 'anthropic-messages' >,
	creds: ResolvedCredentials
): ProviderConfigInput {
	return {
		baseUrl: creds.baseURL,
		apiKey: escapePiConfigValue( creds.apiKey ),
		api: 'anthropic-messages',
		headers: creds.extraHeaders,
		streamSimple: ( m, ctx, options?: SimpleStreamOptions ) => {
			const client = new Anthropic( {
				apiKey: null,
				authToken: options?.apiKey ?? creds.apiKey,
				baseURL: m.baseUrl,
				dangerouslyAllowBrowser: true,
				defaultHeaders: options?.headers,
			} );
			const clientForPi = client as unknown as AnthropicOptions[ 'client' ];
			return streamAnthropic(
				m as Model< 'anthropic-messages' >,
				stripStaleImagesFromContext( ctx ),
				{
					...( options as AnthropicOptions | undefined ),
					...resolveThinkingOptions( m as Model< 'anthropic-messages' >, options ),
					client: clientForPi,
				}
			);
		},
		models: [
			{
				id: model.id,
				name: model.name,
				api: 'anthropic-messages',
				baseUrl: model.baseUrl,
				reasoning: model.reasoning,
				input: model.input,
				cost: model.cost,
				contextWindow: model.contextWindow,
				maxTokens: model.maxTokens,
				headers: creds.extraHeaders,
				compat: model.compat,
			},
		],
	};
}

function createSettingsManager( _env: Record< string, string > ): SettingsManager {
	return SettingsManager.inMemory(
		{
			defaultThinkingLevel: 'high',
			compaction: STUDIO_COMPACTION_SETTINGS,
		},
		{ projectTrusted: false }
	);
}

function toToolDefinition(
	tool: AgentToolAny,
	payloadGuardState: StudioToolPayloadGuardState
): ToolDefinition {
	return {
		name: tool.name,
		label: tool.label,
		description: getPayloadLimitDescription( tool.name, tool.description ),
		parameters: tool.parameters,
		prepareArguments: tool.prepareArguments,
		executionMode: tool.executionMode,
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			const incompleteToolCallReason = getIncompleteToolCallReason( payloadGuardState, toolCallId );
			if ( incompleteToolCallReason ) {
				throw new Error( incompleteToolCallReason );
			}
			const payloadLimitViolation = getPayloadLimitViolation( tool.name, params );
			if ( payloadLimitViolation ) {
				throw new Error( payloadLimitViolation );
			}
			return tool.execute( toolCallId, params, signal, onUpdate );
		},
	};
}

function buildAgentTools(
	config: ResolvedStudioAgentTurnConfig,
	chatArtifactsEnabled: boolean,
	remoteSession: boolean
): AgentToolAny[] {
	const isRemoteSite = Boolean(
		config.activeSite?.remote && config.activeSite?.wpcomSiteId && config.wpcomAccessToken
	);

	const askUserTool: AgentToolAny[] = config.onAskUser
		? [ createAskUserQuestionTool( config.onAskUser ) ]
		: [];

	const skillToolDef = createSkillTool();
	const skillTool: AgentToolAny[] = skillToolDef ? [ skillToolDef ] : [];

	const renameTool = ( tool: AgentToolAny, name: string ): AgentToolAny => ( {
		...tool,
		name,
		label: name,
	} );

	const remoteScratchTools: AgentToolAny[] = [
		renameTool( createReadTool( STUDIO_WPCOM_BODY_FILES_ROOT ), 'Read' ),
		renameTool( createWriteTool( STUDIO_WPCOM_BODY_FILES_ROOT ), 'Write' ),
		renameTool( createEditTool( STUDIO_WPCOM_BODY_FILES_ROOT ), 'Edit' ),
		renameTool( createLsTool( STUDIO_WPCOM_BODY_FILES_ROOT ), 'Ls' ),
	];

	if ( isRemoteSite ) {
		const remoteStudioTools = [ takeScreenshotTool, createSiteTool, pullSiteTool ].map( ( tool ) =>
			withChatArtifactEmission( tool, chatArtifactsEnabled )
		);
		return [
			createWpcomRequestTool( config.wpcomAccessToken!, config.activeSite!.wpcomSiteId! ),
			...remoteStudioTools,
			...remoteScratchTools,
			...askUserTool,
			...skillTool,
		];
	}

	const piTools: AgentToolAny[] = [
		renameTool( createReadTool( STUDIO_SITES_ROOT ), 'Read' ),
		renameTool( createWriteTool( STUDIO_SITES_ROOT ), 'Write' ),
		renameTool( createEditTool( STUDIO_SITES_ROOT ), 'Edit' ),
		renameTool( createBashTool( STUDIO_SITES_ROOT ), 'Bash' ),
		renameTool( createGrepTool( STUDIO_SITES_ROOT ), 'Grep' ),
		renameTool( createFindTool( STUDIO_SITES_ROOT ), 'Glob' ),
		renameTool( createLsTool( STUDIO_SITES_ROOT ), 'Ls' ),
	];
	const studioTools = resolveStudioToolDefinitions( {
		emitChatArtifacts: chatArtifactsEnabled,
		remoteSession,
	} ) as unknown as AgentToolAny[];
	return [ ...studioTools, ...askUserTool, ...skillTool, ...piTools ];
}

function parseJsonHeaderEnv( value: string | undefined ): Record< string, string > | undefined {
	if ( ! value ) return undefined;
	try {
		const parsed: unknown = JSON.parse( value );
		if ( parsed && typeof parsed === 'object' && ! Array.isArray( parsed ) ) {
			const entries = Object.entries( parsed as Record< string, unknown > ).filter(
				( [ , v ] ) => typeof v === 'string'
			) as [ string, string ][];
			return entries.length ? Object.fromEntries( entries ) : undefined;
		}
		console.warn(
			'STUDIO_OPENAI_DEFAULT_HEADERS must be a JSON object of string→string pairs; ignoring custom headers.'
		);
	} catch {
		console.warn(
			'STUDIO_OPENAI_DEFAULT_HEADERS contained malformed JSON; ignoring custom headers.'
		);
	}
	return undefined;
}

function parseAnthropicHeaderEnv(
	value: string | undefined
): Record< string, string > | undefined {
	if ( ! value ) return undefined;
	const out: Record< string, string > = {};
	for ( const line of value.split( '\n' ) ) {
		const idx = line.indexOf( ':' );
		if ( idx <= 0 ) continue;
		const name = line.slice( 0, idx ).trim();
		const v = line.slice( idx + 1 ).trim();
		if ( name && v ) out[ name ] = v;
	}
	return Object.keys( out ).length ? out : undefined;
}
