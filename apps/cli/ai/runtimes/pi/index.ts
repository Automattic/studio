import fs from 'fs';
import path from 'path';
import { type AgentTool } from '@earendil-works/pi-agent-core';
import {
	type Api,
	type Credential,
	type CredentialInfo,
	type CredentialStore,
	type Model,
	type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { streamSimple as streamAnthropicMessages } from '@earendil-works/pi-ai/api/anthropic-messages';
import { streamSimple as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { streamSimple as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses';
import { ANTHROPIC_MODELS } from '@earendil-works/pi-ai/providers/anthropic.models';
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
	type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { readGlobalInstructions } from '@studio/common/ai/global-instructions';
import {
	aiModelSupportsImages,
	DEFAULT_MODEL,
	getAiModel,
	getAiModelFamily,
	type AiModelFamily,
	type AiModelId,
	customModelName,
	type CustomModelId,
} from '@studio/common/ai/models';
import { findLastAssistant, isEmptyStop } from '@studio/common/ai/session-events';
import { type TSchema } from 'typebox';
import { classicThemeQuestion } from 'cli/ai/block-theme';
import { getBlockValidationGate, type BlockValidationGate } from 'cli/ai/block-validation-gate';
import { isImageGenerationAvailable } from 'cli/ai/image-generation';
import { emitEvent } from 'cli/ai/json-events';
import { describeOpenProblems, getOpenProblems } from 'cli/ai/open-problems';
import { NO_CHANGES, SiteChanges } from 'cli/ai/site-changes';
import { readActiveSiteFacts } from 'cli/ai/site-facts';
import { createSiteNotes, type SiteNotes } from 'cli/ai/site-notes';
import { studioMessage, validationLines } from 'cli/ai/studio-message';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { resolveStudioToolDefinitions } from 'cli/ai/tools';
import { createAskUserQuestionTool } from 'cli/ai/tools/ask-user-question';
import { createSkillTool } from 'cli/ai/tools/skill';
import { siteOfCall } from 'cli/ai/tools/utils';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { withDefaultTimeout } from './bash-timeout';
import { createConfirmer, describeDestructiveCall, type Confirmer } from './confirmation';
import { withLeakedToolCallMarkupRemoved } from './leaked-tool-call-markup';
import { createMcpTools, isUserMcpTool, readMcpServers } from './mcp-tools';
import { getPendingWork, type PendingWork } from './pending-work';
import { changesPreview } from './preview-reload';
import { SitePin } from './site-pin';
import { SkillToolScope } from './skill-tool-scope';
import { stripStaleImagesFromContext } from './strip-stale-images';
import { ensureStudioShimDirectory, getStudioShims, prependToPath } from './studio-wp-shim';
import { createSubagentTool } from './subagent';
import { withTextOnlyImages } from './text-only-read';
import {
	getIncompleteToolCallReason,
	getWrittenFile,
	type StudioToolPayloadGuardState,
	updateStudioToolPayloadGuardState,
} from './tool-safety';
import { withUsageCapErrorRewrite } from './usage-cap';
import type { StudioChatImage } from '@studio/common/ai/chat-images';
import type { CustomEndpoint } from '@studio/common/lib/shared-config';
import type { StudioToolResultDetails } from 'cli/ai/tools/define-tool';
import type { AskUserHandler, SiteInfo } from 'cli/ai/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;
type StudioWpcomModel =
	| Model< 'openai-completions' >
	| Model< 'openai-responses' >
	| Model< 'anthropic-messages' >;
type StudioModel = StudioWpcomModel | Model< 'anthropic-messages' >;
type ProviderConfigInput = Parameters< ModelRuntime[ 'registerProvider' ] >[ 1 ];

const STUDIO_WPCOM_PROVIDER = 'studio-wpcom';
const STUDIO_CUSTOM_PROVIDER = 'studio-custom';

/** A turn's model and the runtime that serves it. */
interface TurnModel {
	model: Model< Api >;
	modelRuntime: ModelRuntime;
}

// Chat Completions without the OpenAI-only fields other upstreams reject. With
// `supportsReasoningEffort` false no thinking switch is sent at all and each
// upstream uses its own default.
const PORTABLE_COMPLETIONS_COMPAT = {
	supportsStore: false,
	supportsDeveloperRole: false,
	supportsReasoningEffort: false,
	supportsStrictMode: false,
	maxTokensField: 'max_tokens',
} as const;
const STUDIO_AGENT_DIR = STUDIO_SITES_ROOT;
// A reply with nothing in it ends the turn without the user seeing why (see
// `isEmptyStop`). Resume it with a message the user doesn't see, up to this
// many times per turn. pi leaves a reply that has only reasoning out of the
// next request, so the message carries that reasoning; otherwise the model
// starts the same reasoning over and runs out again.
const MAX_EMPTY_STOP_CONTINUES = 2;
const EMPTY_STOP_CONTINUE_TYPE = 'studio.empty_stop_continue';
const OPEN_PROBLEMS_TYPE = 'studio.open_problems';
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
	activeSite?: SiteInfo | null;
	onAskUser?: AskUserHandler;
	// Answers the harness's confirmations of irreversible calls. Defaults to
	// onAskUser; a scripted user (the eval runner) answers without exposing
	// AskUserQuestion to the agent.
	onConfirm?: AskUserHandler;
	onEvent: ( event: AgentSessionEvent ) => void;
	// A turn run for another turn's subagent call, which runs no subagents of its own.
	subagent?: boolean;
}

interface ResolvedStudioAgentTurnConfig extends StudioAgentTurnConfig {
	env: Record< string, string >;
	model: AiModelId;
}

export interface StudioAgentTurnHandle {
	result: Promise< void >;
	interrupt(): Promise< void >;
	/** Whether `name` is one of the turn's registered tools, not a name the model made up. */
	hasTool( name: string ): boolean;
	/** The system prompt the turn's model requests carry, once its session is set up. */
	systemPrompt(): string | undefined;
}

export function runStudioAgentTurn( config: StudioAgentTurnConfig ): StudioAgentTurnHandle {
	const controller = new AbortController();
	let activeSession: AgentSession | undefined;
	let systemPrompt: string | undefined;
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

interface ResolvedCredentials {
	apiKey: string;
	baseURL: string;
	extraHeaders?: Record< string, string >;
	// The API and image support of a custom endpoint, which its connection states.
	endpoint?: Pick< CustomEndpoint, 'api' | 'images' >;
}

function customEndpointCredentials( endpoint: CustomEndpoint ): ResolvedCredentials {
	return {
		apiKey: endpoint.apiKey,
		baseURL: endpoint.baseUrl,
		endpoint: { api: endpoint.api, images: endpoint.images },
	};
}

function resolveCredentials(
	family: AiModelFamily,
	env: Record< string, string >
): { ok: true; creds: ResolvedCredentials } | { ok: false; reason: string } {
	if ( family === 'custom' ) {
		const endpoint = env.STUDIO_CUSTOM_ENDPOINT;
		if ( ! endpoint ) {
			return {
				ok: false,
				reason: 'No custom endpoint is connected — connect one with /provider.',
			};
		}
		return { ok: true, creds: customEndpointCredentials( JSON.parse( endpoint ) ) };
	}
	if ( family === 'studio' ) {
		const apiKey = env.STUDIO_WPCOM_API_KEY?.trim();
		if ( ! apiKey ) {
			return {
				ok: false,
				reason:
					'The WordPress.com models need a wpcom access token, and STUDIO_WPCOM_API_KEY is not set — run /login to authenticate.',
			};
		}
		const baseURL = env.STUDIO_WPCOM_BASE_URL?.trim();
		if ( ! baseURL ) {
			return { ok: false, reason: 'STUDIO_WPCOM_BASE_URL not set — cannot route to wpcom proxy.' };
		}
		return {
			ok: true,
			creds: {
				apiKey,
				baseURL,
				extraHeaders: parseJsonHeaderEnv(
					'STUDIO_WPCOM_DEFAULT_HEADERS',
					env.STUDIO_WPCOM_DEFAULT_HEADERS
				),
			},
		};
	}

	const apiKey = env.ANTHROPIC_API_KEY?.trim();
	if ( ! apiKey ) {
		return {
			ok: false,
			reason:
				'Anthropic provider selected but ANTHROPIC_API_KEY is not set. Switch to the Anthropic · API key provider with /provider and save a key.',
		};
	}
	return {
		ok: true,
		creds: {
			apiKey,
			baseURL: 'https://api.anthropic.com',
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
	const resolved = await resolveTurnModel( config );
	if ( ! resolved.ok ) {
		config.onEvent( syntheticErrorAgentEnd( 'error', resolved.reason ) );
		return;
	}

	let session: AgentSession | undefined;
	let unsubscribe: ( () => void ) | undefined;
	const payloadGuardState: StudioToolPayloadGuardState = {};
	try {
		session = await createStudioAgentSession( config, resolved, payloadGuardState );
		setActiveSession( session );
		const previewAttached = typeof process.send === 'function';
		const emit = ( event: AgentSessionEvent ) => {
			config.onEvent( event );
			if ( previewAttached && changesPreview( event ) ) {
				emitEvent( { type: 'preview.reload', timestamp: new Date().toISOString() } );
			}
		};
		// The end of each run is held until it is known whether the turn
		// continues: consumers wait for the turn's real end.
		let heldEnd: Extract< AgentSessionEvent, { type: 'agent_end' } > | undefined;
		unsubscribe = session.subscribe( ( event ) => {
			updateStudioToolPayloadGuardState( event, payloadGuardState );
			if ( event.type === 'agent_end' && ! event.willRetry ) {
				heldEnd = event;
				return;
			}
			emit( event );
		} );

		if ( controller.signal.aborted ) {
			await session.abort();
			config.onEvent( syntheticErrorAgentEnd( 'aborted', '' ) );
			return;
		}

		const openProblems = getOpenProblems( config.session );
		let emptyStopContinues = 0;
		// What continues the turn after a run ends, if anything: a reply cut off
		// before it said anything, then the problems still open on the sites.
		const continuation = async (
			end: Extract< AgentSessionEvent, { type: 'agent_end' } >
		): Promise< { customType: string; content: string } | undefined > => {
			const lastAssistant = findLastAssistant( end.messages );
			if ( isEmptyStop( lastAssistant ) && emptyStopContinues < MAX_EMPTY_STOP_CONTINUES ) {
				emptyStopContinues++;
				const cutOffReasoning = ( lastAssistant?.content ?? [] )
					.map( ( block ) => ( block.type === 'thinking' ? block.thinking : '' ) )
					.join( '' )
					.trim();
				return {
					customType: EMPTY_STOP_CONTINUE_TYPE,
					content: cutOffReasoning
						? `Your reasoning was cut off before you replied. Continue from where it stopped:\n\n${ cutOffReasoning }`
						: 'continue',
				};
			}
			if ( lastAssistant?.stopReason !== 'stop' ) {
				return undefined;
			}
			await getPendingWork( config.session ).settle();
			// A block file the run wrote last is validated, and its lossless fix
			// saved, before the sites are checked, as on any later tool result.
			await getBlockValidationGate( config.session ).settle();
			const problems = await openProblems.raise();
			if ( problems.length ) {
				return { customType: OPEN_PROBLEMS_TYPE, content: describeOpenProblems( problems ) };
			}
			// With nothing left to fix, the user is asked what only they choose.
			const answers = config.onAskUser ? await openProblems.ask( config.onAskUser ) : [];
			const told = studioMessage( 'checks', answers );
			return told ? { customType: OPEN_PROBLEMS_TYPE, content: told } : undefined;
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
			if ( ! next ) {
				emit( end );
				break;
			}
			emit( { ...end, willRetry: true } );
			if ( controller.signal.aborted ) {
				config.onEvent( syntheticErrorAgentEnd( 'aborted', '' ) );
				break;
			}
			await session.sendCustomMessage( { ...next, display: false }, { triggerTurn: true } );
		}
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

// The turn's model and the runtime that serves it: a Studio model with the
// credentials of its provider, or a models.json model through pi's registry.
async function resolveTurnModel(
	config: ResolvedStudioAgentTurnConfig
): Promise< ( { ok: true } & TurnModel ) | { ok: false; reason: string } > {
	const family = getAiModelFamily( config.model );
	const resolved = resolveCredentials( family, config.env );
	if ( ! resolved.ok ) {
		return resolved;
	}
	const model = buildModel( config.model, family, resolved.creds );
	return {
		ok: true,
		model,
		modelRuntime: await createModelRuntime( model, family, resolved.creds ),
	};
}

async function createStudioAgentSession(
	config: ResolvedStudioAgentTurnConfig,
	{ model, modelRuntime }: TurnModel,
	payloadGuardState: StudioToolPayloadGuardState
): Promise< AgentSession > {
	const chatArtifactsEnabled = typeof process.send === 'function';
	const visionEnabled = model.input.includes( 'image' );
	const confirm = createConfirmer( config.onConfirm ?? config.onAskUser );
	const [ userInstructions, imageGenerationEnabled, activeSiteFacts, mcpServers ] =
		await Promise.all( [
			readGlobalInstructions(),
			isImageGenerationAvailable(),
			readActiveSiteFacts( config.activeSite ),
			readMcpServers(),
		] );

	const skillScope = new SkillToolScope( config.session );
	let activateTools: () => void = () => {};
	const tools = buildAgentTools(
		config,
		chatArtifactsEnabled,
		imageGenerationEnabled,
		visionEnabled,
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
		userInstructions,
		activeSite: config.activeSite,
		activeSiteFacts: activeSiteFacts.flat(),
	} );

	const pendingWork = getPendingWork( config.session );
	const blockValidationGate = getBlockValidationGate( config.session );
	const sitePin = new SitePin( config.activeSite );
	const site = config.activeSite;
	const localSite = site && ! site.remote ? site.path : undefined;
	const siteNotes = createSiteNotes( {
		// The Active site section already states this turn's facts.
		stated: new Map( localSite ? [ [ path.resolve( localSite ), activeSiteFacts ] ] : [] ),
		gate: blockValidationGate,
	} );
	// What a call changed on the request's sites, or on every local site until
	// the request has one, reported on its result.
	const siteChanges = new SiteChanges( getOpenProblems( config.session ), async () => {
		const { sites } = await readCliConfig();
		const pinned = sitePin.localSitePaths();
		return pinned.length
			? sites.filter( ( { path: sitePath } ) => pinned.includes( path.resolve( sitePath ) ) )
			: sites;
	} );
	const toolDefinitions = [ ...tools, ...mcpTools ].map( ( tool ) =>
		toToolDefinition( tool, payloadGuardState, pendingWork, blockValidationGate, {
			confirm,
			sitePin,
			siteNotes,
			siteChanges,
		} )
	);
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
		input: aiModelSupportsImages( modelId )
			? [ 'text' as const, 'image' as const ]
			: [ 'text' as const ],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		...( creds.extraHeaders ? { headers: creds.extraHeaders } : {} ),
	};

	if ( family === 'custom' ) {
		// The connected endpoint names the model; its connection states the
		// API and whether the model takes images. Thinking is left to the
		// upstream's default, as for the proxy tiers.
		const name = customModelName( modelId as CustomModelId );
		const { api, images } = creds.endpoint!;
		const shared = {
			...common,
			id: name,
			name,
			input: images ? [ 'text' as const, 'image' as const ] : [ 'text' as const ],
			provider: STUDIO_CUSTOM_PROVIDER,
			contextWindow: 200_000,
			maxTokens: 32_000,
		};
		return api === 'openai-completions'
			? { ...shared, api, reasoning: true, compat: PORTABLE_COMPLETIONS_COMPAT }
			: { ...shared, api, reasoning: false };
	}
	if ( family === 'studio' ) {
		// The capability tiers are resolved to upstream models by the wpcom
		// proxy. The context window is a conservative floor across the
		// upstreams a tier may resolve to, so compaction kicks in before any
		// of them overflows.
		//
		// `strong` rides the proxy's Anthropic Messages path, which sits beside
		// `/v1` rather than under it and authenticates with a bearer token.
		if ( modelId === 'strong' ) {
			return {
				...common,
				baseUrl: baseUrl.replace( /\/v1$/, '' ),
				headers: { ...creds.extraHeaders, Authorization: `Bearer ${ creds.apiKey }` },
				api: 'anthropic-messages',
				provider: STUDIO_WPCOM_PROVIDER,
				reasoning: false,
				contextWindow: 200_000,
				maxTokens: 32_000,
			};
		}
		// `balanced` rides the Responses path: its upstream is a reasoning model
		// that rejects tools-plus-reasoning on Chat Completions.
		if ( modelId === 'balanced' ) {
			return {
				...common,
				api: 'openai-responses',
				provider: STUDIO_WPCOM_PROVIDER,
				reasoning: true,
				contextWindow: 200_000,
				maxTokens: 32_000,
			};
		}
		// The other tiers speak Chat Completions. pi infers `compat` from the
		// base URL, which for us reads as plain OpenAI — so spell out the shape
		// or requests carry OpenAI-only fields other upstreams reject. With
		// `supportsReasoningEffort` false no thinking switch is sent at all and
		// each upstream uses its own default — the portable choice across
		// vendors that spell that parameter differently.
		return {
			...common,
			api: 'openai-completions',
			provider: STUDIO_WPCOM_PROVIDER,
			reasoning: true,
			contextWindow: 200_000,
			maxTokens: 32_000,
			compat: PORTABLE_COMPLETIONS_COMPAT,
		};
	}
	// Without `compat.forceAdaptiveThinking` pi-ai sends the legacy
	// `thinking: { type: 'enabled', budget_tokens }` shape, which Sonnet 5 /
	// Opus 5 reject with a 400 — copy the thinking fields from pi's catalog.
	const catalogModel = (
		ANTHROPIC_MODELS as Partial< Record< string, Model< 'anthropic-messages' > > >
	 )[ modelId ];
	return {
		...common,
		api: 'anthropic-messages',
		provider: 'anthropic',
		reasoning: true,
		// contextWindow/maxTokens intentionally stay below the catalog values.
		contextWindow: 200_000,
		// thinkingLevel 'high' reserves ~16384 of this budget for extended thinking
		// (see adjustMaxTokensForThinking in pi-ai); keep enough headroom for visible
		// output so single tool calls can emit a full-page HTML payload.
		maxTokens: 32_000,
		...( catalogModel?.thinkingLevelMap
			? { thinkingLevelMap: catalogModel.thinkingLevelMap }
			: {} ),
		...( catalogModel?.compat ? { compat: catalogModel.compat } : {} ),
	};
}

// In-memory credential store so the runtime never reads or writes an auth.json
// on disk. Studio resolves credentials from the environment on every turn and
// injects them via runtime API keys or registered provider configs, so nothing
// needs to be persisted.
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

/**
 * Whether the connected endpoint answers a short request for `model` the way a
 * turn sends it. Undefined when it does; otherwise the error it gave.
 */
export async function checkCustomEndpoint(
	endpoint: CustomEndpoint,
	model: CustomModelId
): Promise< string | undefined > {
	const creds = customEndpointCredentials( endpoint );
	const built = buildModel( model, 'custom', creds ) as StudioWpcomModel;
	const { streamSimple } = createRegisteredProviderConfig( built, creds, false );
	const reply = await streamSimple!(
		built,
		{ messages: [ { role: 'user', content: 'Reply with: ok', timestamp: Date.now() } ] },
		{ apiKey: creds.apiKey, maxTokens: 16 }
	).result();
	return reply.stopReason === 'error' ? reply.errorMessage ?? 'The request failed.' : undefined;
}

async function createModelRuntime(
	model: StudioModel,
	family: AiModelFamily,
	creds: ResolvedCredentials
): Promise< ModelRuntime > {
	const modelRuntime = await ModelRuntime.create( {
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
	} );

	if ( family !== 'anthropic' ) {
		modelRuntime.registerProvider(
			model.provider,
			createRegisteredProviderConfig( model as StudioWpcomModel, creds, family === 'studio' )
		);
		return modelRuntime;
	}

	await modelRuntime.setRuntimeApiKey( family, creds.apiKey );
	return modelRuntime;
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

// The wpcom proxy and a custom endpoint only need pi's stock streaming for each
// model's API; the provider is registered to wrap the stream with the leaked
// tool-call cleanup and to strip stale screenshots, which would otherwise bloat
// requests past a body limit. The proxy's stream also gets its usage-cap 429
// rewrite, and its requests name the tier's current upstream alias.
function createRegisteredProviderConfig(
	model: StudioWpcomModel,
	creds: ResolvedCredentials,
	proxy: boolean
): ProviderConfigInput {
	// pi types `streamSimple` against `Model<Api>`; each API's stream function
	// is narrower, and the model registered below is the one passed in.
	const stream = (
		model.api === 'openai-completions'
			? streamOpenAiCompletions
			: model.api === 'anthropic-messages'
			? streamAnthropicMessages
			: streamOpenAiResponses
	) as NonNullable< ProviderConfigInput[ 'streamSimple' ] >;
	// The model keeps its stable id for pi and the session history; only the
	// request names the proxy's current upstream alias.
	const apiModelId = proxy ? getAiModel( model.id as AiModelId ).apiModelId : undefined;
	const clean: NonNullable< ProviderConfigInput[ 'streamSimple' ] > = ( m, ctx, options ) =>
		withLeakedToolCallMarkupRemoved(
			stream( m, stripStaleImagesFromContext( ctx ), {
				...options,
				...( apiModelId
					? {
							onPayload: async ( params: unknown, payloadModel ) => {
								const next = ( await options?.onPayload?.( params, payloadModel ) ) ?? params;
								return { ...( next as Record< string, unknown > ), model: apiModelId };
							},
					  }
					: {} ),
			} )
		);
	return {
		baseUrl: creds.baseURL,
		apiKey: escapePiConfigValue( creds.apiKey ),
		api: model.api,
		headers: creds.extraHeaders,
		streamSimple: proxy
			? ( m, ctx, options?: SimpleStreamOptions ) =>
					withUsageCapErrorRewrite( clean( m, ctx, options ) )
			: clean,
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

// A shell command can put content on the site through WP-CLI.
const BLOCK_VALIDATION_GATED_TOOLS = new Set( [ 'Bash', 'take_screenshot' ] );
// Tools that change nothing on a site, so there is nothing to check after them.
const READ_ONLY_TOOLS = new Set( [ 'Read', 'Grep', 'Glob', 'Ls' ] );

function toToolDefinition(
	tool: AgentToolAny,
	payloadGuardState: StudioToolPayloadGuardState,
	pendingWork: PendingWork,
	blockValidationGate: BlockValidationGate,
	{
		confirm,
		sitePin,
		siteNotes,
		siteChanges,
	}: {
		confirm: Confirmer;
		sitePin: SitePin;
		siteNotes: SiteNotes;
		siteChanges: SiteChanges;
	}
): ToolDefinition {
	return {
		name: tool.name,
		label: tool.label,
		description: tool.description,
		parameters: tool.parameters,
		prepareArguments: tool.prepareArguments,
		executionMode: tool.executionMode,
		execute: async ( toolCallId, params, signal, onUpdate ) => {
			const incompleteToolCallReason = getIncompleteToolCallReason( payloadGuardState, toolCallId );
			if ( incompleteToolCallReason ) {
				throw new Error( incompleteToolCallReason );
			}
			// An irreversible call names its site in its own question, so it
			// needs no second one about which site it changes.
			const destructive = describeDestructiveCall( tool.name, params );
			const crossSite = destructive
				? undefined
				: await sitePin.confirmationFor( tool.name, params );
			const writtenFile = getWrittenFile( tool.name, params, STUDIO_SITES_ROOT );
			const declined = await confirm(
				destructive ??
					crossSite?.confirmation ??
					( writtenFile ? await classicThemeQuestion( writtenFile ) : undefined )
			);
			if ( declined?.endsTurn ) {
				return { content: [ { type: 'text', text: declined.text } ], details: {}, terminate: true };
			}
			if ( declined ) {
				throw new Error( declined.text );
			}
			crossSite?.allow();
			const fileWriteRefusal = writtenFile && ( await siteNotes.beforeWrite( writtenFile ) );
			if ( fileWriteRefusal ) {
				throw new Error( fileWriteRefusal );
			}
			if ( ( tool as { settlesPendingWork?: boolean } ).settlesPendingWork ) {
				await pendingWork.settle();
			} else {
				// A file written or edited is all such a call touches: markup naming
				// an image still being generated reads nothing of it.
				await pendingWork.settleFilesIn( writtenFile ?? params );
			}
			// Block markup written since the last check is validated before any
			// tool puts content on the site or renders it.
			const validationReport = BLOCK_VALIDATION_GATED_TOOLS.has( tool.name )
				? validationLines( await blockValidationGate.settle() )
				: [];
			const checksChanges = ! READ_ONLY_TOOLS.has( tool.name );
			if ( checksChanges ) {
				await siteChanges.snapshot().catch( () => undefined );
			}
			// A call that fails can still have changed content, as a shell
			// command does that exits non-zero after saving a page.
			const settled = async () =>
				checksChanges ? await siteChanges.settle().catch( () => NO_CHANGES ) : NO_CHANGES;
			// The validation report was taken from the gate, so it rides on a failure too.
			const result = await tool
				.execute( toolCallId, params, signal, onUpdate )
				.catch( async ( error: unknown ) => {
					const changed = await settled();
					const report = studioMessage( 'notes', [
						...validationReport,
						...changed.summaries,
						...changed.problems,
					] );
					if ( ! report ) {
						throw error;
					}
					throw new Error(
						`${ error instanceof Error ? error.message : String( error ) }\n${ report }`
					);
				} );
			if ( tool.name === 'site_create' ) {
				await sitePin.created( String( ( params as { name?: unknown } ).name ) );
			}
			const details = result.details as StudioToolResultDetails | undefined;
			if ( details?.pending ) {
				pendingWork.add( details.pending, details.pendingFiles );
				delete details.pending;
				delete details.pendingFiles;
			}
			const changed = await settled();
			// The files the call wrote, by its file tool or otherwise, as a shell command does.
			const written = new Set( [ ...( writtenFile ? [ writtenFile ] : [] ), ...changed.written ] );
			// The site a call names, or else the request's own, whose facts any
			// call can change, as a shell command installing a plugin does.
			const resultSite = ( await siteOfCall( tool, params ) )?.path ?? sitePin.localRequestSite();
			const resultText = result.content
				.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
				.join( '\n' );
			const reports = studioMessage( 'notes', [
				...validationReport,
				...changed.summaries,
				...changed.problems,
				...(
					await Promise.all( [ ...written ].map( ( file ) => siteNotes.afterWrite( file ) ) )
				).flat(),
				...( resultSite ? await siteNotes.afterResult( resultSite, resultText ) : [] ),
				pendingWork.takeReports(),
			] );
			return reports
				? { ...result, content: [ ...result.content, { type: 'text', text: reports } ] }
				: result;
		},
	};
}

// Every chunk of the CLI bundle sits next to `main.mjs`, so it is this
// module's sibling; `STUDIO_CLI_BIN` points elsewhere in development.
function getStudioWpSpawnHook() {
	const cliPath = process.env.STUDIO_CLI_BIN ?? path.join( import.meta.dirname, 'main.mjs' );
	return prependToPath( ensureStudioShimDirectory( getStudioShims( process.execPath, cliPath ) ) );
}

function buildAgentTools(
	config: ResolvedStudioAgentTurnConfig,
	chatArtifactsEnabled: boolean,
	imageGenerationEnabled: boolean,
	visionEnabled: boolean,
	onSkillLoad: ( skillName: string ) => void
): AgentToolAny[] {
	const askUserTool: AgentToolAny[] = config.onAskUser
		? [ createAskUserQuestionTool( config.onAskUser ) ]
		: [];

	const skillToolDef = createSkillTool( ( skill ) => onSkillLoad( skill.name ) );
	const skillTool: AgentToolAny[] = skillToolDef ? [ skillToolDef ] : [];

	// pi's tools are registered under Studio's names.
	const renameTool = < S extends TSchema >( tool: AgentTool< S >, name: string ): AgentTool< S > =>
		( { ...tool, name, label: name } ) as AgentTool< S >;

	const piTools: AgentToolAny[] = [
		renameTool(
			visionEnabled
				? createReadTool( STUDIO_SITES_ROOT )
				: withTextOnlyImages( createReadTool( STUDIO_SITES_ROOT ) ),
			'Read'
		),
		renameTool( createWriteTool( STUDIO_SITES_ROOT ), 'Write' ),
		renameTool( createEditTool( STUDIO_SITES_ROOT ), 'Edit' ),
		renameTool(
			withDefaultTimeout(
				createBashTool( STUDIO_SITES_ROOT, { spawnHook: getStudioWpSpawnHook() } )
			),
			'Bash'
		),
		renameTool( createGrepTool( STUDIO_SITES_ROOT ), 'Grep' ),
		renameTool( createFindTool( STUDIO_SITES_ROOT ), 'Glob' ),
		renameTool( createLsTool( STUDIO_SITES_ROOT ), 'Ls' ),
	];
	const studioTools = resolveStudioToolDefinitions( {
		emitChatArtifacts: chatArtifactsEnabled,
		shell: true,
		imageGeneration: imageGenerationEnabled,
		visionEnabled,
	} ) as unknown as AgentToolAny[];
	// A subagent's turn is this turn's, from a fresh session and with nobody to
	// ask: confirmations still reach the user.
	const subagentTool: AgentToolAny[] = config.subagent
		? []
		: [
				createSubagentTool( ( task, onEvent ) =>
					runStudioAgentTurn( {
						prompt: task,
						session: SessionManager.inMemory( STUDIO_SITES_ROOT ),
						env: config.env,
						model: config.model,
						activeSite: config.activeSite,
						onConfirm: config.onConfirm ?? config.onAskUser,
						onEvent,
						subagent: true,
					} )
				),
		  ];
	return [ ...studioTools, ...askUserTool, ...skillTool, ...subagentTool, ...piTools ];
}

function parseJsonHeaderEnv(
	name: string,
	value: string | undefined
): Record< string, string > | undefined {
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
			`${ name } must be a JSON object of string→string pairs; ignoring custom headers.`
		);
	} catch {
		console.warn( `${ name } contained malformed JSON; ignoring custom headers.` );
	}
	return undefined;
}
