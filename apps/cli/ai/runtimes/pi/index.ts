import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { type AgentTool } from '@earendil-works/pi-agent-core';
import { type Model, type SimpleStreamOptions } from '@earendil-works/pi-ai';
import {
	stream as streamAnthropic,
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
import { readGlobalInstructions } from '@studio/common/ai/global-instructions';
import {
	DEFAULT_MODEL,
	getAiModelFamily,
	type AiModelFamily,
	type SelectedModelId,
} from '@studio/common/ai/models';
import {
	getSiteRuntime,
	SITE_RUNTIME_NATIVE_PHP,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { getAiPayloadsPath, getConfigDirectory } from '@studio/common/lib/well-known-paths';
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
type StudioModel =
	| Model< 'openai-responses' >
	| Model< 'openai-completions' >
	| Model< 'anthropic-messages' >;
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
	model?: SelectedModelId;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: AskUserHandler;
	onEvent: ( event: AgentSessionEvent ) => void;
}

interface ResolvedStudioAgentTurnConfig extends StudioAgentTurnConfig {
	env: Record< string, string >;
	model: SelectedModelId;
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
	// OpenAI wire flavor. The built-in GPT path uses the Responses API; a
	// local `openai-compatible` endpoint uses chat/completions. Only set for
	// the `openai` family.
	openaiApi?: 'responses' | 'completions';
	// Real context window of a local `openai-compatible` model, discovered
	// from its `/v1/models` endpoint. Drives pi's native compaction so long
	// conversations stay within the local model's limit.
	contextWindow?: number;
}

// Fallback context window for a local `openai-compatible` model when its real
// window couldn't be discovered.
const DEFAULT_OPENAI_COMPATIBLE_CONTEXT_WINDOW = 8192;

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
		// A local `openai-compatible` endpoint sets this marker; it speaks
		// chat/completions and carries its own context window. Absent the
		// marker this is the wpcom/OpenAI Responses path.
		const isLocalCompletions = env.STUDIO_OPENAI_COMPLETIONS?.trim() === '1';
		const contextWindow = Number.parseInt( env.STUDIO_OPENAI_COMPLETIONS_CONTEXT_WINDOW ?? '', 10 );
		return {
			ok: true,
			creds: {
				apiKey,
				baseURL,
				extraHeaders: parseJsonHeaderEnv( env.STUDIO_OPENAI_DEFAULT_HEADERS ),
				useBearerAuth: false,
				openaiApi: isLocalCompletions ? 'completions' : 'responses',
				contextWindow:
					Number.isFinite( contextWindow ) && contextWindow > 0 ? contextWindow : undefined,
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
	const [ userInstructions, runtime ] = await Promise.all( [
		readGlobalInstructions(),
		isRemoteSite ? undefined : resolveActiveSiteRuntime( config.activeSite ),
	] );

	const systemPrompt = buildSystemPrompt(
		isRemoteSite
			? {
					remoteSite: {
						name: config.activeSite!.name,
						url: config.activeSite!.url ?? '',
						id: config.activeSite!.wpcomSiteId!,
					},
					remoteSession,
					userInstructions,
			  }
			: {
					chatArtifactsEnabled,
					remoteSession,
					runtime,
					userInstructions,
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
	modelId: SelectedModelId,
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
		// A local `openai-compatible` endpoint speaks chat/completions and
		// declares its own (usually much smaller) context window, discovered
		// from `/v1/models`. pi's native compaction keeps sessions within it.
		if ( creds.openaiApi === 'completions' ) {
			const contextWindow = creds.contextWindow ?? DEFAULT_OPENAI_COMPATIBLE_CONTEXT_WINDOW;
			// Keep max output well under the window. pi clamps output tokens to
			// the window minus its context estimate; on a small local window an
			// over-large value can clamp down to 1 (a 400 from the server), so
			// scale with the window and cap it.
			const maxTokens = Math.max( 512, Math.min( 8_192, Math.floor( contextWindow / 4 ) ) );
			return {
				...common,
				api: 'openai-completions',
				provider: 'openai',
				// Reasoning is an OpenAI-hosted feature; local models generally
				// don't support it and can reject the parameter.
				reasoning: false,
				contextWindow,
				maxTokens,
			};
		}
		// GPT-5.6 models reject function tools on /v1/chat/completions unless
		// reasoning is disabled; the Responses API supports tools + reasoning.
		// GPT-5.6 Sol's real context window is 1.05M tokens, but we declare
		// 272K — the threshold where OpenAI's 2x long-context pricing kicks
		// in — so compaction keeps sessions below it. Understating the window
		// is also load-bearing for correctness: pi clamps max output tokens to
		// the declared window minus its (post-compaction, sometimes stale)
		// context estimate, and a too-small window can clamp all the way down
		// to 1, which the API rejects with a 400.
		return {
			...common,
			api: 'openai-responses',
			provider: 'openai',
			reasoning: true,
			contextWindow: 272_000,
			maxTokens: 32_000,
		};
	}
	return {
		...common,
		api: 'anthropic-messages',
		provider: creds.useBearerAuth ? STUDIO_WPCOM_ANTHROPIC_PROVIDER : 'anthropic',
		reasoning: true,
		contextWindow: 200_000,
		// thinkingLevel 'high' reserves ~16384 of this budget for extended thinking
		// (see adjustMaxTokensForThinking in pi-ai); keep enough headroom for visible
		// output so single tool calls can emit a full-page HTML payload.
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
