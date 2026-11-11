import fs from 'fs';
import { type AgentTool } from '@earendil-works/pi-agent-core';
import {
	type Credential,
	type CredentialInfo,
	type CredentialStore,
	type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import { streamSimple as streamAnthropicMessages } from '@earendil-works/pi-ai/api/anthropic-messages';
import { streamSimple as streamOpenAiCompletions } from '@earendil-works/pi-ai/api/openai-completions';
import { streamSimple as streamOpenAiResponses } from '@earendil-works/pi-ai/api/openai-responses';
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
import { withDesignSystemPreview } from '@studio/agent/node/chat-artifacts';
import { readGlobalInstructions } from '@studio/agent/node/global-instructions';
import { createResultNotes } from '@studio/agent/node/result-notes';
import { buildSystemPrompt, type ToolPromptContribution } from '@studio/agent/node/system-prompt';
import { resolveStudioTools } from '@studio/agent/node/tools';
import { createAskUserQuestionTool } from '@studio/agent/node/tools/ask-user-question';
import { bindTool } from '@studio/agent/node/tools/define-tool';
import { createPresentDesignOptionsTool } from '@studio/agent/node/tools/present-design-options';
import { createSkillTool } from '@studio/agent/node/tools/skill';
import { findLastAssistant, isEmptyStop } from '@studio/agent/protocol/session-events';
import { withErrorRewrite } from './error-rewrite';
import { getFileToolPrompt } from './file-tool-prompts';
import { withLeakedToolCallMarkupRemoved } from './leaked-tool-call-markup';
import { getPendingWork, type PendingWork } from './pending-work';
import { stripStaleImagesFromContext } from './strip-stale-images';
import {
	getIncompleteToolCallReason,
	getFileWriteRefusal,
	getPayloadLimitViolation,
	type StudioToolPayloadGuardState,
	updateStudioToolPayloadGuardState,
} from './tool-safety';
import type { StudioAgentHost } from '@studio/agent/node/host';
import type { ImageGenerator } from '@studio/agent/node/image-generation';
import type { StudioToolResultDetails } from '@studio/agent/node/tools/define-tool';
import type { AskUserHandler, SiteInfo } from '@studio/agent/node/types';
import type { StudioChatImage } from '@studio/agent/protocol/chat-images';
import type { AiConnection } from '@studio/providers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;
type ProviderConfigInput = Parameters< ModelRuntime[ 'registerProvider' ] >[ 1 ];

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
	// The model to run on, as the provider serving it connects to it.
	ai: AiConnection;
	// A connected provider's image generation; enables generate_images.
	generateImages?: ImageGenerator;
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
	const payloadGuardState: StudioToolPayloadGuardState = {};
	try {
		session = await createStudioAgentSession( config, payloadGuardState );
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
	payloadGuardState: StudioToolPayloadGuardState
): Promise< AgentSession > {
	const { model } = config.ai;
	const userInstructions = await readGlobalInstructions();
	const tools = buildAgentTools( config, model.input.includes( 'image' ) );
	const systemPrompt = buildSystemPrompt( {
		userInstructions,
		tools: tools.map( toolPromptContribution ),
		activeSite: config.activeSite,
	} );

	const pendingWork = getPendingWork( config.session );
	const site = config.activeSite;
	const notes = createResultNotes();
	const resultNotes =
		site && ! site.remote ? ( text: string ) => notes( site.path, text ) : undefined;
	const toolDefinitions = tools.map( ( tool ) =>
		toToolDefinition( config.host, tool, payloadGuardState, pendingWork, resultNotes )
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
// registration exists to wrap the stream with the connection's error rewrite
// and the leaked tool-call cleanup, and to strip stale screenshots, which would
// otherwise bloat requests past the provider's body limit.
function createProviderConfig( {
	apiKey,
	headers,
	model,
	requestModelId,
	rewriteError,
}: AiConnection ): ProviderConfigInput {
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
	// request names the provider's upstream alias.
	return {
		baseUrl: model.baseUrl,
		apiKey: escapePiConfigValue( apiKey ),
		api: model.api,
		headers,
		streamSimple: ( m, ctx, options?: SimpleStreamOptions ) =>
			withErrorRewrite(
				withLeakedToolCallMarkupRemoved(
					stream( m, stripStaleImagesFromContext( ctx ), {
						...options,
						...( requestModelId
							? {
									onPayload: async ( params: unknown, payloadModel ) => {
										const next = ( await options?.onPayload?.( params, payloadModel ) ) ?? params;
										return { ...( next as Record< string, unknown > ), model: requestModelId };
									},
							  }
							: {} ),
					} )
				),
				rewriteError
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
			if ( ( tool as { settlesPendingWork?: boolean } ).settlesPendingWork ) {
				await pendingWork.settle();
			}
			const result = await tool.execute( toolCallId, params, signal, onUpdate );
			const details = result.details as StudioToolResultDetails | undefined;
			if ( details?.pending ) {
				pendingWork.add( details.pending );
				delete details.pending;
			}
			const resultText = result.content
				.map( ( part ) => ( part.type === 'text' ? part.text : '' ) )
				.join( '\n' );
			const notes = [ await resultNotes?.( resultText ), pendingWork.takeReports() ]
				.filter( Boolean )
				.join( '\n' );
			return notes
				? { ...result, content: [ ...result.content, { type: 'text', text: notes } ] }
				: result;
		},
	};
}

function buildAgentTools(
	config: ResolvedStudioAgentTurnConfig,
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
		withDesignSystemPreview( tool, sitesRoot, ui );
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
		generateImages: config.generateImages,
		visionEnabled,
		canAskUser: Boolean( config.onAskUser ),
		tracks,
	} ) as unknown as AgentToolAny[];
	return [ ...studioTools, ...askUserTool, ...designOptionsTool, ...skillTool, ...piTools ];
}
