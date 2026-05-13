import fs from 'fs';
import Anthropic from '@anthropic-ai/sdk';
import { type AgentEvent, type AgentTool } from '@mariozechner/pi-agent-core';
import { type Model, type SimpleStreamOptions } from '@mariozechner/pi-ai';
import { streamAnthropic, type AnthropicOptions } from '@mariozechner/pi-ai/anthropic';
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
	type ExtensionFactory,
	type SessionManager,
	type ToolDefinition,
} from '@mariozechner/pi-coding-agent';
import {
	DEFAULT_MODEL,
	getAiModelFamily,
	type AiModelFamily,
	type AiModelId,
} from '@studio/common/ai/models';
import {
	createDlaPolicyFactory,
	defaultPolicyBuckets,
	startDlaBridge,
	type DlaBridge,
} from '@studio/dla';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { resolveStudioToolDefinitions } from 'cli/ai/tools';
import { createAskUserQuestionTool } from 'cli/ai/tools/ask-user-question';
import { createSiteTool } from 'cli/ai/tools/create-site';
import { pullSiteTool } from 'cli/ai/tools/pull-site';
import { createSkillTool } from 'cli/ai/tools/skill';
import { takeScreenshotTool } from 'cli/ai/tools/take-screenshot';
import { createWpcomRequestTool } from 'cli/ai/tools/wpcom-request';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { AskUserHandler, SiteInfo } from 'cli/ai/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;
type StudioModel = Model< 'openai-completions' > | Model< 'anthropic-messages' >;
type ProviderConfigInput = Parameters< ModelRegistry[ 'registerProvider' ] >[ 1 ];

const STUDIO_WPCOM_ANTHROPIC_PROVIDER = 'studio-wpcom-anthropic';
const STUDIO_AGENT_DIR = STUDIO_SITES_ROOT;
const STUDIO_COMPACTION_SETTINGS = {
	enabled: true,
	reserveTokens: 16_384,
	keepRecentTokens: 20_000,
};

export interface StudioAgentTurnConfig {
	prompt: string;
	session: SessionManager;
	env?: Record< string, string >;
	model?: AiModelId;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: AskUserHandler;
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
): AgentEvent {
	return {
		type: 'agent_end',
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
	const dlaBridge = await maybeStartDlaBridge( config );
	try {
		session = await createStudioAgentSession( config, family, resolved.creds, dlaBridge );
		setActiveSession( session );
		unsubscribe = session.subscribe( config.onEvent );

		if ( controller.signal.aborted ) {
			await session.abort();
			config.onEvent( syntheticErrorAgentEnd( 'aborted', '' ) );
			return;
		}

		await session.prompt( config.prompt, { expandPromptTemplates: false, source: 'rpc' } );
	} catch ( error ) {
		const aborted = controller.signal.aborted;
		const message = aborted ? '' : error instanceof Error ? error.message : String( error );
		config.onEvent( syntheticErrorAgentEnd( aborted ? 'aborted' : 'error', message ) );
	} finally {
		unsubscribe?.();
		session?.dispose();
		setActiveSession( undefined );
		await dlaBridge?.dispose();
	}
}

/**
 * Bring up the Data Liberation Agent (DLA) MCP bridge for this session,
 * gated on `STUDIO_DLA_ENABLED === '1'`.
 *
 * Failures to spawn or connect the bridge are non-fatal: a warning is
 * logged and `undefined` is returned so the session still starts with the
 * usual Studio tools. The bridge itself also degrades gracefully (returning
 * `degraded: true` with an empty tool list) when `listTools` fails — in
 * that case the bridge handle is still returned so the caller can dispose
 * it during teardown.
 *
 * The wpcom access token, when present in the session config, is forwarded
 * to the DLA child as `STUDIO_WPCOM_TOKEN` so DLA can authenticate against
 * WordPress.com APIs when surfacing remote-site flows.
 *
 * @param config - The resolved session config for this turn.
 * @returns A `DlaBridge` handle, or `undefined` when DLA is disabled or
 *   the bridge could not be constructed at all.
 */
async function maybeStartDlaBridge(
	config: ResolvedStudioAgentTurnConfig
): Promise< DlaBridge | undefined > {
	if ( config.env.STUDIO_DLA_ENABLED !== '1' ) {
		return undefined;
	}
	try {
		const bridge = await startDlaBridge( {
			wpcomToken: config.wpcomAccessToken,
		} );
		if ( bridge.degraded ) {
			console.warn(
				`[studio code] DLA bridge degraded; continuing without DLA tools (${
					bridge.degradationReason ?? 'unknown reason'
				}).`
			);
		}
		return bridge;
	} catch ( error ) {
		const reason = error instanceof Error ? error.message : String( error );
		console.warn(
			`[studio code] DLA bridge failed to start; continuing without DLA tools (${ reason }).`
		);
		return undefined;
	}
}

async function createStudioAgentSession(
	config: ResolvedStudioAgentTurnConfig,
	family: AiModelFamily,
	creds: ResolvedCredentials,
	dlaBridge?: DlaBridge
): Promise< AgentSession > {
	const model = buildModel( config.model, family, creds );
	const isRemoteSite = Boolean( config.activeSite?.remote && config.activeSite?.wpcomSiteId );
	const isForkedByDesktop = typeof process.send === 'function';
	const remoteSession = config.env.STUDIO_REMOTE_SESSION === '1';

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
			: { previewSteering: isForkedByDesktop, remoteSession }
	);

	const toolDefinitions = buildAgentTools( config, isForkedByDesktop, remoteSession, dlaBridge );
	const { authStorage, modelRegistry } = createModelRegistry( model, family, creds );
	const settingsManager = createSettingsManager( config.env );
	const extensionFactories = resolveDlaExtensionFactories( config.env );
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
		extensionFactories,
	} );
	await resourceLoader.reload();

	const result = await createAgentSession( {
		cwd: STUDIO_SITES_ROOT,
		agentDir: STUDIO_AGENT_DIR,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: 'high',
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
		input: [ 'text' as const ],
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
	return {
		...common,
		api: 'anthropic-messages',
		provider: creds.useBearerAuth ? STUDIO_WPCOM_ANTHROPIC_PROVIDER : 'anthropic',
		reasoning: true,
		contextWindow: 200_000,
		maxTokens: 8_192,
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

function createWpcomAnthropicProviderConfig(
	model: Model< 'anthropic-messages' >,
	creds: ResolvedCredentials
): ProviderConfigInput {
	return {
		baseUrl: creds.baseURL,
		apiKey: creds.apiKey,
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
			return streamAnthropic( m as Model< 'anthropic-messages' >, ctx, {
				...( options as AnthropicOptions | undefined ),
				client: clientForPi,
			} );
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
	return SettingsManager.inMemory( {
		defaultThinkingLevel: 'high',
		compaction: STUDIO_COMPACTION_SETTINGS,
	} );
}

/**
 * Build the list of pi `ExtensionFactory` values to feed into
 * `DefaultResourceLoader.extensionFactories` based on the session's env.
 *
 * Inline `extensionFactories` are loaded even when `noExtensions: true`
 * is set on `DefaultResourceLoader` (verified at `resource-loader.js`'s
 * `loadExtensionFactories` path), so the runtime keeps the rest of the
 * extension discovery surface disabled while still mounting the DLA
 * policy hook when the feature flag is on.
 *
 * The DLA policy factory is only mounted when
 * `STUDIO_DLA_ENABLED === '1'`. v1 ships with the flag off by default;
 * the same flag also gates the DLA bridge spawn in `runAgentSessionTurn`
 * (handled separately) so the policy hook is a no-op when the bridge is
 * inactive.
 *
 * @param env - The resolved process env for this session.
 * @returns An array of factories to forward to `DefaultResourceLoader`.
 *   Empty when DLA is disabled.
 */
function resolveDlaExtensionFactories( env: Record< string, string > ): ExtensionFactory[] {
	if ( env.STUDIO_DLA_ENABLED !== '1' ) {
		return [];
	}
	return [ createDlaPolicyFactory( defaultPolicyBuckets ) ];
}

function toToolDefinition( tool: AgentToolAny ): ToolDefinition {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		prepareArguments: tool.prepareArguments,
		executionMode: tool.executionMode,
		execute: async ( toolCallId, params, signal, onUpdate ) =>
			tool.execute( toolCallId, params, signal, onUpdate ),
	};
}

/**
 * Build the `customTools` list passed to pi's `createAgentSession`. The
 * Studio-native tools (returned as `AgentTool` values) are converted to
 * pi's `ToolDefinition` shape via `toToolDefinition`, and the bridged DLA
 * tools — already `ToolDefinition[]` — are spliced into the local-site
 * tool list when `dlaBridge` is supplied.
 *
 * The DLA tools intentionally do not appear in the remote-site branch
 * because the remote flow already steers callers toward WordPress.com
 * APIs (`wpcom_request`), and bridging DLA there risks recursive migration
 * loops back into Studio itself.
 *
 * @param config - The resolved per-turn session config.
 * @param enablePreviewSteering - Whether the runtime is forked by the
 *   desktop app (which steers users toward the Preview Site flow).
 * @param remoteSession - Whether this is a remote, WPCOM-backed session.
 * @param dlaBridge - Optional DLA bridge handle; when present, its
 *   `tools` are spliced into the local-site tool list. When absent
 *   (e.g. `STUDIO_DLA_ENABLED` is unset or the bridge failed to spawn)
 *   the result matches the legacy tool list exactly.
 * @returns The fully assembled `ToolDefinition[]` for the session.
 */
function buildAgentTools(
	config: ResolvedStudioAgentTurnConfig,
	enablePreviewSteering: boolean,
	remoteSession: boolean,
	dlaBridge?: DlaBridge
): ToolDefinition[] {
	const isRemoteSite = Boolean(
		config.activeSite?.remote && config.activeSite?.wpcomSiteId && config.wpcomAccessToken
	);

	const askUserTool: AgentToolAny[] = config.onAskUser
		? [ createAskUserQuestionTool( config.onAskUser ) ]
		: [];

	const skillToolDef = createSkillTool();
	const skillTool: AgentToolAny[] = skillToolDef ? [ skillToolDef ] : [];

	if ( isRemoteSite ) {
		const remoteTools: AgentToolAny[] = [
			createWpcomRequestTool( config.wpcomAccessToken!, config.activeSite!.wpcomSiteId! ),
			takeScreenshotTool,
			createSiteTool,
			pullSiteTool,
			...askUserTool,
			...skillTool,
		];
		return remoteTools.map( toToolDefinition );
	}

	const renameTool = ( tool: AgentToolAny, name: string ): AgentToolAny => ( {
		...tool,
		name,
		label: name,
	} );

	const piTools: AgentToolAny[] = [
		renameTool( createReadTool( STUDIO_SITES_ROOT ), 'Read' ),
		renameTool( createWriteTool( STUDIO_SITES_ROOT ), 'Write' ),
		renameTool( createEditTool( STUDIO_SITES_ROOT ), 'Edit' ),
		renameTool( createBashTool( STUDIO_SITES_ROOT ), 'Bash' ),
		renameTool( createGrepTool( STUDIO_SITES_ROOT ), 'Grep' ),
		renameTool( createFindTool( STUDIO_SITES_ROOT ), 'Glob' ),
		renameTool( createLsTool( STUDIO_SITES_ROOT ), 'Ls' ),
	];
	const studioTools: AgentToolAny[] = [
		...resolveStudioToolDefinitions( { enablePreviewSteering, remoteSession } ),
		...askUserTool,
		...skillTool,
		...piTools,
	];
	return [ ...studioTools.map( toToolDefinition ), ...( dlaBridge?.tools ?? [] ) ];
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
