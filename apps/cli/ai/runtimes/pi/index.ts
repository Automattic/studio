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
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { resolveStudioToolDefinitions } from 'cli/ai/tools';
import { createAskUserQuestionTool } from 'cli/ai/tools/ask-user-question';
import { createSiteTool } from 'cli/ai/tools/create-site';
import { pullSiteTool } from 'cli/ai/tools/pull-site';
import { createSkillTool } from 'cli/ai/tools/skill';
import { takeScreenshotTool } from 'cli/ai/tools/take-screenshot';
import { createWpcomRequestTool } from 'cli/ai/tools/wpcom-request';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import {
	decideCompaction,
	runCompaction,
	STUDIO_COMPACTION_SETTINGS,
	type CompactionReason,
} from './auto-compaction';
import type { AgentRuntime, AgentRuntimeConfig, AgentRuntimeHandle } from '../types';
import type { AgentRuntimeEvent, CompactionEndEvent } from 'cli/ai/runtimes/runtime-events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;

interface CachedAgent {
	agent: Agent;
	model: Model< 'openai-completions' > | Model< 'anthropic-messages' >;
	creds: ResolvedCredentials;
	overflowRecoveryAttempted: boolean;
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
): AsyncGenerator< AgentRuntimeEvent, void, void > {
	const family = getAiModelFamily( config.model );
	const resolved = resolveCredentials( family, config.env );
	if ( ! resolved.ok ) {
		yield syntheticErrorAgentEnd( 'error', resolved.reason );
		return;
	}

	try {
		const cached = await getOrCreateAgent( sessionId, config, family, resolved.creds );
		const { agent, model, creds } = cached;

		const queue: AgentRuntimeEvent[] = [];
		let resolveNext: ( () => void ) | null = null;
		let done = false;

		const wake = () => {
			resolveNext?.();
			resolveNext = null;
		};

		// Auto-compaction takes over the agent_end → done=true transition.
		// `pendingCompaction` keeps `done` false while the compaction promise
		// resolves so the loop drains compaction events before exiting.
		let pendingCompaction = false;

		const handleAgentEnd = async (
			lastAssistant: AssistantMessage | undefined
		): Promise< void > => {
			if ( ! lastAssistant ) return;
			const decision = decideCompaction( {
				assistantMessage: lastAssistant,
				agent,
				sessionManager: config.session,
				model,
				settings: STUDIO_COMPACTION_SETTINGS,
				overflowRecoveryAttempted: cached.overflowRecoveryAttempted,
				skipAbortedCheck: true,
			} );

			if ( decision.kind === 'none' ) return;

			if ( decision.kind === 'overflow_already_attempted' ) {
				queue.push( { type: 'compaction_start', reason: 'overflow' } );
				queue.push( {
					type: 'compaction_end',
					reason: 'overflow',
					result: undefined,
					aborted: false,
					willRetry: false,
					errorMessage: decision.errorMessage,
				} );
				wake();
				return;
			}

			const reason: CompactionReason = decision.kind;
			const willRetry = reason === 'overflow';

			pendingCompaction = true;
			queue.push( { type: 'compaction_start', reason } );
			wake();

			// Overflow: drop the failed assistant from agent state before we
			// summarize so it doesn't leak into the kept tail.
			if ( reason === 'overflow' ) {
				cached.overflowRecoveryAttempted = true;
				const messages = agent.state.messages;
				if ( messages.length > 0 && messages[ messages.length - 1 ] === lastAssistant ) {
					agent.state.messages = messages.slice( 0, -1 );
				}
			}

			let endEvent: CompactionEndEvent;
			try {
				const result = await runCompaction( {
					agent,
					sessionManager: config.session,
					model,
					apiKey: creds.apiKey,
					headers: creds.extraHeaders,
					settings: STUDIO_COMPACTION_SETTINGS,
					signal: controller.signal,
					tokensBefore:
						lastAssistant.stopReason === 'error'
							? 0
							: calculateContextTokens( lastAssistant.usage ),
				} );
				endEvent = {
					type: 'compaction_end',
					reason,
					result,
					aborted: controller.signal.aborted,
					willRetry,
				};
			} catch ( error ) {
				const errorMessage = error instanceof Error ? error.message : 'compaction failed';
				endEvent = {
					type: 'compaction_end',
					reason,
					result: undefined,
					aborted: false,
					willRetry: false,
					errorMessage:
						reason === 'overflow'
							? `Context overflow recovery failed: ${ errorMessage }`
							: `Auto-compaction failed: ${ errorMessage }`,
				};
			}

			queue.push( endEvent );
			pendingCompaction = false;

			// Overflow path: kick the loop again so the user actually gets an
			// answer to the prompt that just overflowed.
			if ( willRetry && ! controller.signal.aborted && endEvent.result ) {
				agent.continue().catch( () => undefined );
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
				const lastAssistant = findLastAssistant( event.messages );
				// Reset the overflow flag on a fresh, successful turn so a
				// later overflow gets one recovery attempt of its own.
				if ( lastAssistant?.stopReason === 'stop' ) {
					cached.overflowRecoveryAttempted = false;
				}
				// The handler decides whether to compact (and possibly retry
				// via agent.continue()); we only mark `done` once we know no
				// further work is queued.
				void handleAgentEnd( lastAssistant ).then( () => {
					if ( ! pendingCompaction && ! agentWillRetry() ) {
						done = true;
						wake();
					}
				} );
			}

			wake();
		} );

		// True while we're inside an overflow → continue() recovery cycle —
		// the next agent_end is the retry's terminator, not the run's.
		const agentWillRetry = (): boolean => agent.state.isStreaming;

		// Persist the user prompt before agent.prompt runs so disk matches the
		// transcript the model sees.
		config.session.appendMessage( {
			role: 'user',
			content: config.prompt,
			timestamp: Date.now(),
		} );

		// Pre-flight compaction: pi's AgentSession runs `_checkCompaction` on
		// the latest assistant before sending. Mirrors that so a session
		// resumed near the threshold gets compacted before we hit the wall.
		const preflightAssistant = findLastAssistant( agent.state.messages );
		if ( preflightAssistant ) {
			const decision = decideCompaction( {
				assistantMessage: preflightAssistant,
				agent,
				sessionManager: config.session,
				model,
				settings: STUDIO_COMPACTION_SETTINGS,
				overflowRecoveryAttempted: cached.overflowRecoveryAttempted,
				skipAbortedCheck: false,
			} );
			if ( decision.kind === 'threshold' ) {
				queue.push( { type: 'compaction_start', reason: 'threshold' } );
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
						tokensBefore: calculateContextTokens( preflightAssistant.usage ),
					} );
					queue.push( {
						type: 'compaction_end',
						reason: 'threshold',
						result,
						aborted: controller.signal.aborted,
						willRetry: false,
					} );
				} catch ( error ) {
					const errorMessage = error instanceof Error ? error.message : 'compaction failed';
					queue.push( {
						type: 'compaction_end',
						reason: 'threshold',
						result: undefined,
						aborted: false,
						willRetry: false,
						errorMessage: `Auto-compaction failed: ${ errorMessage }`,
					} );
				}
				wake();
			}
		}

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
	const initialMessages = existing
		? existing.agent.state.messages
		: config.session.buildSessionContext().messages;

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

	const cached: CachedAgent = {
		agent,
		model,
		creds,
		overflowRecoveryAttempted: false,
	};
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
