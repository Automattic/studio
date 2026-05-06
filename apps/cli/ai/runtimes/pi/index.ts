import Anthropic from '@anthropic-ai/sdk';
import { Agent, type AgentEvent, type AgentTool, type StreamFn } from '@mariozechner/pi-agent-core';
import {
	type AssistantMessage,
	type Message,
	type Model,
	type ToolResultMessage,
} from '@mariozechner/pi-ai';
import { streamAnthropic, type AnthropicOptions } from '@mariozechner/pi-ai/anthropic';
import {
	buildSessionContext,
	calculateContextTokens,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from '@mariozechner/pi-coding-agent';
import { getAiModelFamily, type AiModelFamily, type AiModelId } from '@studio/common/ai/models';
import { filterEntriesAfterLastClear } from '@studio/common/ai/sessions/filter-events';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { resolveStudioToolDefinitions } from 'cli/ai/tools';
import { createAskUserQuestionTool } from 'cli/ai/tools/ask-user-question';
import { createSiteTool } from 'cli/ai/tools/create-site';
import { pullSiteTool } from 'cli/ai/tools/pull-site';
import { createSkillTool } from 'cli/ai/tools/skill';
import { takeScreenshotTool } from 'cli/ai/tools/take-screenshot';
import { createWpcomRequestTool } from 'cli/ai/tools/wpcom-request';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { runCompaction, shouldCompact, STUDIO_COMPACTION_SETTINGS } from './auto-compaction';
import type { AgentRuntime, AgentRuntimeConfig, AgentRuntimeHandle } from '../types';
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;

interface CachedAgent {
	agent: Agent;
	model: Model< 'openai-completions' > | Model< 'anthropic-messages' >;
	creds: ResolvedCredentials;
}

const AGENTS_BY_SESSION = new Map< string, CachedAgent >();

export const piRuntime: AgentRuntime = {
	run( config: AgentRuntimeConfig ): AgentRuntimeHandle {
		const sessionId = config.session.getSessionId();
		const controller = new AbortController();
		const events = createEventStream( config, sessionId, controller );

		return {
			async interrupt() {
				controller.abort();
				AGENTS_BY_SESSION.get( sessionId )?.agent.abort();
			},
			[ Symbol.asyncIterator ]() {
				return events[ Symbol.asyncIterator ]();
			},
		};
	},
};

// Drop any cached `Agent` for `sessionId`. Called from the orchestrator on
// `/clear` so the next turn rebuilds the agent with the post-clear branch
// — `agent.state.messages` is otherwise sticky across turns and would
// keep showing the model the pre-clear transcript.
export function clearAgentForSession( sessionId: string ): void {
	AGENTS_BY_SESSION.delete( sessionId );
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

function findLastAssistant(
	messages: ReadonlyArray< { role: string } >
): AssistantMessage | undefined {
	for ( let i = messages.length - 1; i >= 0; i -= 1 ) {
		if ( messages[ i ].role === 'assistant' ) return messages[ i ] as AssistantMessage;
	}
	return undefined;
}

async function* createEventStream(
	config: AgentRuntimeConfig,
	sessionId: string,
	controller: AbortController
): AsyncGenerator< AgentSessionEvent, void, void > {
	const family = getAiModelFamily( config.model );
	const resolved = resolveCredentials( family, config.env );
	if ( ! resolved.ok ) {
		yield syntheticErrorAgentEnd( 'error', resolved.reason );
		return;
	}

	try {
		const cached = await getOrCreateAgent( sessionId, config, family, resolved.creds );
		const { agent, model, creds } = cached;

		const queue: AgentSessionEvent[] = [];
		let resolveNext: ( () => void ) | null = null;
		let done = false;

		const wake = () => {
			resolveNext?.();
			resolveNext = null;
		};

		// Run pi-style auto-compaction after the agent finishes a turn.
		// Compaction events flow through `queue` like any other runtime
		// event; while compaction is in flight `done` stays false so the
		// loop drains them before exiting. No `agent.continue()` retry on
		// overflow — the user re-prompts; the next request sees the
		// compacted transcript.
		const compactAfterAgentEnd = async ( last: AssistantMessage ): Promise< void > => {
			const reason = shouldCompact( last, model, STUDIO_COMPACTION_SETTINGS );
			if ( ! reason ) return;
			queue.push( { type: 'compaction_start', reason } );
			wake();
			try {
				const result = await runCompaction( {
					agent,
					sessionManager: config.session,
					model,
					apiKey: creds.apiKey,
					headers: creds.extraHeaders,
					settings: STUDIO_COMPACTION_SETTINGS,
					signal: controller.signal,
					tokensBefore: last.stopReason === 'error' ? 0 : calculateContextTokens( last.usage ),
				} );
				queue.push( {
					type: 'compaction_end',
					reason,
					result,
					aborted: controller.signal.aborted,
					willRetry: false,
				} );
			} catch ( error ) {
				queue.push( {
					type: 'compaction_end',
					reason,
					result: undefined,
					aborted: false,
					willRetry: false,
					errorMessage: error instanceof Error ? error.message : 'compaction failed',
				} );
			}
			wake();
		};

		const unsubscribe = agent.subscribe( ( event: AgentEvent ) => {
			if ( event.type === 'turn_end' ) {
				config.session.appendMessage( event.message as Message );
				for ( const tr of event.toolResults as ToolResultMessage[] ) {
					config.session.appendMessage( tr );
				}
			}

			queue.push( event );

			if ( event.type === 'agent_end' ) {
				const last = findLastAssistant( event.messages );
				const work = last ? compactAfterAgentEnd( last ) : Promise.resolve();
				void work.then( () => {
					done = true;
					wake();
				} );
			}

			wake();
		} );

		// Persist the user prompt before agent.prompt runs so disk matches the
		// transcript the model sees.
		config.session.appendMessage( {
			role: 'user',
			content: config.prompt,
			timestamp: Date.now(),
		} );

		const runPromise = agent.prompt( config.prompt );

		while ( true ) {
			if ( queue.length > 0 ) {
				yield queue.shift()!;
				continue;
			}
			if ( done ) break;
			if ( controller.signal.aborted ) break;
			await new Promise< void >( ( resolve ) => {
				resolveNext = resolve;
			} );
		}

		unsubscribe();
		await runPromise.catch( () => undefined );

		// If we exited the loop because the abort signal fired before pi
		// emitted its own `agent_end`, synthesize one so consumers always
		// see exactly one final event.
		if ( ! done && controller.signal.aborted ) {
			yield syntheticErrorAgentEnd( 'aborted', '' );
		}
	} catch ( error ) {
		const aborted = controller.signal.aborted;
		const message = aborted ? '' : error instanceof Error ? error.message : String( error );
		yield syntheticErrorAgentEnd( aborted ? 'aborted' : 'error', message );
	}
}

async function getOrCreateAgent(
	sessionId: string,
	config: AgentRuntimeConfig,
	family: AiModelFamily,
	creds: ResolvedCredentials
): Promise< CachedAgent > {
	const existing = AGENTS_BY_SESSION.get( sessionId );
	if ( existing && existing.agent.state.model.id === config.model ) {
		// Refresh creds in case env tokens rotated between turns.
		existing.creds = creds;
		return existing;
	}

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

	const tools = buildAgentTools( config, isForkedByDesktop );

	// `/model` swap reuses the prior transcript; cold fork hydrates from disk.
	// Pi's `buildSessionContext()` doesn't honor Studio's `studio.session_cleared`
	// marker — pre-filter the branch through `filterEntriesAfterLastClear` so a
	// resumed session that ended with `/clear` doesn't leak old turns to the
	// model.
	const initialMessages = existing
		? existing.agent.state.messages
		: buildSessionContext( filterEntriesAfterLastClear( config.session.getBranch() ) ).messages;

	const streamFn: StreamFn | undefined =
		family === 'anthropic' && creds.useBearerAuth
			? buildAnthropicBearerStreamFn( creds )
			: undefined;

	const agent = new Agent( {
		initialState: {
			model,
			systemPrompt,
			messages: initialMessages,
			tools,
			thinkingLevel: 'high',
		},
		getApiKey: () => creds.apiKey,
		sessionId,
		...( streamFn ? { streamFn } : {} ),
	} );

	const cached: CachedAgent = { agent, model, creds };
	AGENTS_BY_SESSION.set( sessionId, cached );
	return cached;
}

function buildModel(
	modelId: AiModelId,
	family: AiModelFamily,
	creds: ResolvedCredentials
): Model< 'openai-completions' > | Model< 'anthropic-messages' > {
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
		provider: 'anthropic',
		reasoning: true,
		contextWindow: 200_000,
		maxTokens: 8_192,
	};
}

function buildAnthropicBearerStreamFn( creds: ResolvedCredentials ): StreamFn {
	const client = new Anthropic( {
		apiKey: null,
		authToken: creds.apiKey,
		baseURL: creds.baseURL,
		dangerouslyAllowBrowser: true,
		defaultHeaders: creds.extraHeaders,
	} );
	const clientForPi = client as unknown as AnthropicOptions[ 'client' ];
	return ( m, ctx, options ) =>
		streamAnthropic( m as Model< 'anthropic-messages' >, ctx, {
			...( options as AnthropicOptions | undefined ),
			client: clientForPi,
		} );
}

function buildAgentTools(
	config: AgentRuntimeConfig,
	enablePreviewSteering: boolean
): AgentToolAny[] {
	const isRemoteSite = Boolean(
		config.activeSite?.remote && config.activeSite?.wpcomSiteId && config.wpcomAccessToken
	);

	const askUserTool: AgentToolAny[] = config.onAskUser
		? [ createAskUserQuestionTool( config.onAskUser ) ]
		: [];

	const skillToolDef = createSkillTool();
	const skillTool: AgentToolAny[] = skillToolDef ? [ skillToolDef ] : [];

	if ( isRemoteSite ) {
		return [
			createWpcomRequestTool( config.wpcomAccessToken!, config.activeSite!.wpcomSiteId! ),
			takeScreenshotTool,
			createSiteTool,
			pullSiteTool,
			...askUserTool,
			...skillTool,
		];
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
	return [
		...resolveStudioToolDefinitions( { enablePreviewSteering } ),
		...askUserTool,
		...skillTool,
		...piTools,
	];
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
