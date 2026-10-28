import fs from 'fs';
import { type AgentTool } from '@earendil-works/pi-agent-core';
import {
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
	type SessionManager,
	type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { getAiTracksIdentity } from '@studio/common/lib/tracks-identity';
import { type TSchema } from 'typebox';
import { readGlobalInstructions } from '@studio/agent/node/global-instructions';
import {
	aiModelSupportsImages,
	DEFAULT_MODEL,
	getAiModel,
	getAiModelFamily,
	type AiModelFamily,
	type AiModelId,
} from '@studio/agent/protocol/models';
import { findLastAssistant, isEmptyStop } from '@studio/agent/protocol/session-events';
import { withDesignSystemPreview } from '@studio/agent/shared/chat-artifacts';
import { getFileToolPrompt } from '@studio/agent/shared/file-tool-prompts';
import { runWithPendingWork } from '@studio/agent/shared/pending-work';
import { createResultNotes } from '@studio/agent/shared/result-notes';
import { withLeakedToolCallMarkupRemoved } from '@studio/agent/shared/runtime-guards/leaked-tool-call-markup';
import { stripStaleImagesFromContext } from '@studio/agent/shared/runtime-guards/strip-stale-images';
import { withUsageCapErrorRewrite } from '@studio/agent/shared/runtime-guards/usage-cap';
import { buildSystemPrompt, type ToolPromptContribution } from '@studio/agent/shared/system-prompt';
import { resolveStudioTools } from '@studio/agent/shared/tools';
import { createAskUserQuestionTool } from '@studio/agent/shared/tools/ask-user-question';
import { bindTool } from '@studio/agent/shared/tools/define-tool';
import { createPresentDesignOptionsTool } from '@studio/agent/shared/tools/present-design-options';
import { createSkillTool } from '@studio/agent/shared/tools/skill';
import { getPendingWork, type PendingWork } from './pending-work';
import {
	getIncompleteToolCallReason,
	getFileWriteRefusal,
	getPayloadLimitViolation,
	type StudioToolPayloadGuardState,
	updateStudioToolPayloadGuardState,
} from './tool-safety';
import type { StudioChatImage } from '@studio/agent/protocol/chat-images';
import type { StudioAgentHost } from '@studio/agent/shared/host';
import type { AskUserHandler, SiteInfo } from '@studio/agent/shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;
type StudioWpcomModel =
	| Model< 'openai-completions' >
	| Model< 'openai-responses' >
	| Model< 'anthropic-messages' >;
type StudioModel = StudioWpcomModel | Model< 'anthropic-messages' >;
type ProviderConfigInput = Parameters< ModelRuntime[ 'registerProvider' ] >[ 1 ];

const STUDIO_WPCOM_PROVIDER = 'studio-wpcom';
// A reply with nothing in it ends the turn without the user seeing why (see
// `isEmptyStop`). Resume it with a message the user doesn't see, up to this
// many times per turn. pi leaves a reply that has only reasoning out of the
// next request, so the message carries that reasoning; otherwise the model
// starts the same reasoning over and runs out again.
const MAX_EMPTY_STOP_CONTINUES = 2;
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
	env?: Record< string, string >;
	model?: AiModelId;
	activeSite?: SiteInfo | null;
	onAskUser?: AskUserHandler;
	onEvent: ( event: AgentSessionEvent ) => void;
}

interface ResolvedStudioAgentTurnConfig extends StudioAgentTurnConfig {
	host: StudioAgentHost;
	env: Record< string, string >;
	model: AiModelId;
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
	const resolvedConfig: ResolvedStudioAgentTurnConfig = {
		...config,
		host,
		env: config.env ?? { ...( process.env as Record< string, string > ) },
		model: config.model ?? DEFAULT_MODEL,
	};

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

interface ResolvedCredentials {
	apiKey: string;
	baseURL: string;
	extraHeaders?: Record< string, string >;
}

function resolveCredentials(
	family: AiModelFamily,
	env: Record< string, string >
): { ok: true; creds: ResolvedCredentials } | { ok: false; reason: string } {
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
		let emptyStopContinues = 0;
		let continueAfterEmptyStop = false;
		let cutOffReasoning = '';
		unsubscribe = session.subscribe( ( event ) => {
			updateStudioToolPayloadGuardState( event, payloadGuardState );
			if (
				event.type === 'agent_end' &&
				! event.willRetry &&
				emptyStopContinues < MAX_EMPTY_STOP_CONTINUES
			) {
				const lastAssistant = findLastAssistant( event.messages );
				if ( isEmptyStop( lastAssistant ) ) {
					// Not final: consumers wait for the turn's real end.
					continueAfterEmptyStop = true;
					cutOffReasoning = ( lastAssistant?.content ?? [] )
						.map( ( block ) => ( block.type === 'thinking' ? block.thinking : '' ) )
						.join( '' )
						.trim();
					config.onEvent( { ...event, willRetry: true } );
					return;
				}
			}
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
					content: cutOffReasoning
						? `Your reasoning was cut off before you replied. Continue from where it stopped:\n\n${ cutOffReasoning }`
						: 'continue',
					display: false,
				},
				{ triggerTurn: true }
			);
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

async function createStudioAgentSession(
	config: ResolvedStudioAgentTurnConfig,
	family: AiModelFamily,
	creds: ResolvedCredentials,
	payloadGuardState: StudioToolPayloadGuardState
): Promise< AgentSession > {
	const model = buildModel( config.model, family, creds );
	const visionEnabled = aiModelSupportsImages( config.model );
	const { files, path } = config.host;
	const designPath =
		config.activeSite && ! config.activeSite.remote
			? path.join( config.activeSite.path, 'DESIGN.md' )
			: undefined;
	const [ userInstructions, imageGenerationEnabled, hasDesign ] = await Promise.all( [
		readGlobalInstructions(),
		config.host.wpcom.imageToken().then( Boolean ),
		designPath ? files.exists( designPath ) : false,
	] );

	const tools = buildAgentTools( config, imageGenerationEnabled, visionEnabled );
	const systemPrompt = buildSystemPrompt( {
		userInstructions,
		tools: tools.map( toolPromptContribution ),
		activeSite: config.activeSite,
		activeSiteDesignPath: hasDesign ? designPath : undefined,
	} );

	const pendingWork = getPendingWork( config.session );
	const site = config.activeSite;
	const notes = createResultNotes( config.host );
	const resultNotes =
		site && ! site.remote ? ( text: string ) => notes( site.path, text ) : undefined;
	const toolDefinitions = tools.map( ( tool ) =>
		toToolDefinition( config.host, tool, payloadGuardState, pendingWork, resultNotes )
	);
	const modelRuntime = await createModelRuntime( model, family, creds );
	const settingsManager = createSettingsManager( config.env );
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
			compat: {
				supportsStore: false,
				supportsDeveloperRole: false,
				supportsReasoningEffort: false,
				supportsStrictMode: false,
				maxTokensField: 'max_tokens',
			},
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

async function createModelRuntime(
	model: StudioModel,
	family: AiModelFamily,
	creds: ResolvedCredentials
): Promise< ModelRuntime > {
	const modelRuntime = await ModelRuntime.create( {
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
	} );

	if ( family === 'studio' ) {
		modelRuntime.registerProvider(
			model.provider,
			createWpcomProviderConfig( model as StudioWpcomModel, creds )
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

// The wpcom lane only needs pi's stock streaming for each tier's API; the
// custom provider exists to wrap the stream with the usage-cap 429 rewrite and
// the leaked tool-call cleanup, and to strip stale screenshots, which would
// otherwise bloat requests past the proxy's body limit.
function createWpcomProviderConfig(
	model: StudioWpcomModel,
	creds: ResolvedCredentials
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
	const apiModelId = getAiModel( model.id as AiModelId )?.apiModelId;
	return {
		baseUrl: creds.baseURL,
		apiKey: escapePiConfigValue( creds.apiKey ),
		api: model.api,
		headers: creds.extraHeaders,
		streamSimple: ( m, ctx, options?: SimpleStreamOptions ) =>
			withUsageCapErrorRewrite(
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
				)
			),
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

// pi's tools declare a prompt snippet and so do Studio's (see define-tool.ts);
// the AgentTool type does not carry it, hence the cast.
type ToolPromptFields = { promptSnippet?: string };

function toolPromptContribution( tool: AgentToolAny ): ToolPromptContribution {
	return { name: tool.name, promptSnippet: ( tool as ToolPromptFields ).promptSnippet };
}

function toToolDefinition(
	host: StudioAgentHost,
	tool: AgentToolAny,
	payloadGuardState: StudioToolPayloadGuardState,
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
			const incompleteToolCallReason = getIncompleteToolCallReason( payloadGuardState, toolCallId );
			if ( incompleteToolCallReason ) {
				throw new Error( incompleteToolCallReason );
			}
			const payloadLimitViolation = getPayloadLimitViolation( tool.name, params );
			if ( payloadLimitViolation ) {
				throw new Error( payloadLimitViolation );
			}
			const fileWriteRefusal = await getFileWriteRefusal(
				tool.name,
				params,
				host.sitesRoot,
				async ( folder ) => Boolean( await host.sites.findByFolder( folder ) )
			);
			if ( fileWriteRefusal ) {
				throw new Error( fileWriteRefusal );
			}
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
	visionEnabled: boolean
): AgentToolAny[] {
	const { host } = config;
	const askUserTool: AgentToolAny[] = config.onAskUser
		? [ bindTool( createAskUserQuestionTool( config.onAskUser ), host ) ]
		: [];
	const tracks = getAiTracksIdentity( config.session.getSessionId() );
	const designOptionsTool: AgentToolAny[] =
		config.onAskUser && host.ui
			? [
					bindTool(
						createPresentDesignOptionsTool( { onAskUser: config.onAskUser, tracks } ),
						host
					) as unknown as AgentToolAny,
			  ]
			: [];

	const skillToolDef = createSkillTool();
	const skillTool: AgentToolAny[] = skillToolDef ? [ bindTool( skillToolDef, host ) ] : [];

	// pi's tools are registered under Studio's names; the prompt text for them
	// is Studio's too (file-tool-prompts.ts), so nothing of pi's wording leaks.
	const renameTool = < S extends TSchema >( tool: AgentTool< S >, name: string ): AgentTool< S > =>
		( { ...tool, name, label: name, ...getFileToolPrompt( name ) } ) as AgentTool< S >;

	const { sitesRoot, ui } = host;
	const designSystemPreview = < TTool extends AgentToolAny >( tool: TTool ) =>
		ui ? withDesignSystemPreview( tool, host, ui ) : tool;
	const piTools: AgentToolAny[] = [
		renameTool( createReadTool( sitesRoot ), 'Read' ),
		designSystemPreview( renameTool( createWriteTool( sitesRoot ), 'Write' ) ),
		designSystemPreview( renameTool( createEditTool( sitesRoot ), 'Edit' ) ),
		renameTool( createBashTool( sitesRoot ), 'Bash' ),
		renameTool( createGrepTool( sitesRoot ), 'Grep' ),
		renameTool( createFindTool( sitesRoot ), 'Glob' ),
		renameTool( createLsTool( sitesRoot ), 'Ls' ),
	];
	const studioTools = resolveStudioTools( host, {
		imageGeneration: imageGenerationEnabled,
		visionEnabled,
		canAskUser: Boolean( config.onAskUser ),
		tracks,
	} ) as unknown as AgentToolAny[];
	return [ ...studioTools, ...askUserTool, ...designOptionsTool, ...skillTool, ...piTools ];
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
