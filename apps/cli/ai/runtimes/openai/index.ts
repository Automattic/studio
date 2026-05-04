import crypto from 'crypto';
import {
	Agent,
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
} from '@mariozechner/pi-agent-core';
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from '@mariozechner/pi-coding-agent';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { studioToolDefinitions } from 'cli/ai/tools';
import { createAskUserQuestionTool } from 'cli/ai/tools/ask-user-question';
import { createSiteTool } from 'cli/ai/tools/create-site';
import { pullSiteTool } from 'cli/ai/tools/pull-site';
import { createSkillTool } from 'cli/ai/tools/skill';
import { takeScreenshotTool } from 'cli/ai/tools/take-screenshot';
import { createWpcomRequestTool } from 'cli/ai/tools/wpcom-request';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { buildTransformContext } from './compaction';
import { loadSidecar, saveSidecar } from './persistence';
import { adaptToolsForPi } from './pi-tool-adapter';
import type { AgentRuntime, AgentRuntimeConfig, AgentRuntimeHandle } from '../types';
import type { SDKMessage, SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { Model } from '@mariozechner/pi-ai';

/**
 * OpenAI runtime — pi-agent-core edition.
 *
 * Uses `@mariozechner/pi-agent-core`'s `Agent` class for the tool loop and
 * conversation state, and `@mariozechner/pi-ai`'s OpenAI Chat Completions
 * provider for the actual LLM call. Both packages accept `baseUrl` + headers
 * + apiKey as first-class arguments, so the wpcom AI proxy is just a Model
 * with a custom baseUrl/headers and the wpcom access token as apiKey.
 *
 * Session persistence is baked in: an `Agent` owns its transcript, and
 * successive `prompt()` calls append to it. We keep Agents in a module-scoped
 * Map keyed by our session id so `config.resume` across turns lands back on
 * the same Agent with its full message history.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;

/**
 * Per-Agent mutable handle for compaction lifecycle. The Agent's
 * `transformContext` closure is built once at Agent construction (and reused
 * across cache hits), but each `run()` wants to receive lifecycle callbacks
 * into its own message queue. The closure dereferences `ref.current` at call
 * time, so each `createMessageStream` can swap a fresh handler in for the
 * duration of its run and clear it on exit — without rebuilding the Agent.
 */
type CompactionPhase = 'start' | 'end' | 'skipped' | 'failed';
interface CompactionLifecycleRef {
	current: ( ( phase: CompactionPhase ) => void ) | null;
}

const AGENTS_BY_SESSION = new Map< string, Agent >();
const LIFECYCLE_REFS_BY_SESSION = new Map< string, CompactionLifecycleRef >();

/**
 * Returns true when the given session id was issued by this runtime. agent.ts
 * uses this at dispatch time to detect cross-family model swaps mid-session
 * (e.g. user ran a turn on GPT, then switched to Sonnet). Without this check,
 * the Anthropic runtime would forward the OpenAI-issued session id to the
 * Claude Agent SDK as `resume`, which doesn't recognize it and errors with
 * "No conversation found with session ID: …". The check is in-memory only —
 * across CLI process restarts the map is empty and we can't distinguish the
 * two runtimes' session ids; a fully persistent fix would require tagging
 * session.linked events with the model family.
 */
export function isOpenAIRuntimeSession( sessionId: string ): boolean {
	return AGENTS_BY_SESSION.has( sessionId );
}

export const openaiRuntime: AgentRuntime = {
	run( config: AgentRuntimeConfig ): AgentRuntimeHandle {
		const sessionId = config.resume ?? crypto.randomUUID();
		const controller = new AbortController();
		const messages = createMessageStream( config, sessionId, controller );

		return {
			async interrupt() {
				controller.abort();
				AGENTS_BY_SESSION.get( sessionId )?.abort();
			},
			[ Symbol.asyncIterator ]() {
				return messages[ Symbol.asyncIterator ]();
			},
		};
	},
};

async function* createMessageStream(
	config: AgentRuntimeConfig,
	sessionId: string,
	controller: AbortController
): AsyncGenerator< SDKMessage, void, void > {
	const start = Date.now();
	yield makeSystemInit( sessionId, config.model );

	const apiKey = config.env.OPENAI_API_KEY?.trim();
	if ( ! apiKey ) {
		yield makeAssistantText(
			sessionId,
			config.model,
			'OpenAI provider selected but OPENAI_API_KEY is not set. On the WordPress.com provider this means the wpcom access token is missing — run /login to authenticate.'
		);
		yield makeResultError( sessionId, start );
		return;
	}

	const baseURL = config.env.OPENAI_BASE_URL?.trim();
	if ( ! baseURL ) {
		yield makeAssistantText(
			sessionId,
			config.model,
			'OPENAI_BASE_URL not set — cannot route to wpcom proxy.'
		);
		yield makeResultError( sessionId, start );
		return;
	}

	const extraHeaders = parseHeaderEnv( config.env.STUDIO_OPENAI_DEFAULT_HEADERS );

	try {
		const { agent, lifecycleRef } = await getOrCreateAgent(
			sessionId,
			config,
			baseURL,
			apiKey,
			extraHeaders
		);

		// Emit all SDKMessages produced since we last iterated. pi's event
		// stream is push-based via `subscribe()`, so we bridge to our
		// generator with a simple queue.
		const queue: SDKMessage[] = [];
		let resolveNext: ( () => void ) | null = null;
		let done = false;

		const wake = () => {
			resolveNext?.();
			resolveNext = null;
		};

		// Synthesize SDK system messages around compaction so the UI shows a
		// loader during summarization and a "Conversation history compacted"
		// boundary marker after — same surface the Claude Agent SDK emits
		// natively and the desktop UI already knows how to render
		// (see `apps/cli/ai/ui.ts:2243-2249`).
		lifecycleRef.current = ( phase ) => {
			if ( phase === 'start' ) {
				queue.push( makeSystemStatus( sessionId, 'compacting' ) );
				wake();
			} else if ( phase === 'end' ) {
				queue.push( makeCompactBoundary( sessionId ) );
				wake();
			}
		};

		const unsubscribe = agent.subscribe( ( event ) => {
			for ( const msg of translateEvent( event, sessionId, config.model, start ) ) {
				queue.push( msg );
			}
			if ( event.type === 'agent_end' ) {
				done = true;
			}
			wake();
		} );

		// Kick off the turn. Don't await here — we want the subscription-driven
		// generator to emit messages as they arrive.
		const runPromise = agent.prompt( config.prompt );

		while ( true ) {
			if ( queue.length > 0 ) {
				const msg = queue.shift()!;
				yield msg;
				continue;
			}
			if ( done ) break;
			if ( controller.signal.aborted ) break;
			await new Promise< void >( ( resolve ) => {
				resolveNext = resolve;
			} );
		}

		unsubscribe();
		// Detach from the cached agent's lifecycle ref so a stale closure
		// can't keep pushing into our (now-finished) queue if a follow-up
		// run reuses the same Agent before our handler is overwritten.
		lifecycleRef.current = null;
		await runPromise.catch( () => undefined );

		// Persist the post-turn transcript so the next CLI fork can resume.
		// Best-effort: failure to write doesn't abort the (already finished)
		// turn — the run still appears successful to the caller and the user.
		// The next fork would just start with empty memory in the worst case.
		if ( config.sessionFilePath ) {
			await saveSidecar( config.sessionFilePath, agent.state.messages ).catch( () => undefined );
		}
	} catch ( error ) {
		if ( controller.signal.aborted ) {
			yield makeResultError( sessionId, start );
			return;
		}
		const message = error instanceof Error ? error.message : String( error );
		yield makeAssistantText( sessionId, config.model, `OpenAI runtime error: ${ message }` );
		yield makeResultError( sessionId, start );
	}
}

/**
 * Returns the `Agent` for this session, creating it on first use. Subsequent
 * turns reuse the same Agent so the transcript accumulates naturally across
 * the CLI's turn-by-turn interaction within a single process.
 *
 * Two cases force a rebuild rather than a cache hit:
 *   - **No cached Agent (cold start)**: e.g. the first turn of a new session,
 *     or the first fork from the desktop UI for a resumed session. We
 *     hydrate messages from the sidecar (see `persistence.ts`) so pi's
 *     transcript survives across CLI process forks.
 *   - **Cached Agent but model changed**: the user ran `/model` mid-session.
 *     `Agent` captures `model` once at construction (and `transformContext`
 *     closes over it for compaction calls), so the only correct way to
 *     honor the swap is to rebuild — preserving the prior transcript so
 *     conversation continuity isn't lost. Without this branch the cache
 *     would happily return the old-model Agent forever, and `/model` would
 *     silently no-op for the live runtime.
 */
async function getOrCreateAgent(
	sessionId: string,
	config: AgentRuntimeConfig,
	baseURL: string,
	apiKey: string,
	extraHeaders: Record< string, string > | undefined
): Promise< { agent: Agent; lifecycleRef: CompactionLifecycleRef } > {
	const existing = AGENTS_BY_SESSION.get( sessionId );
	const existingRef = LIFECYCLE_REFS_BY_SESSION.get( sessionId );
	if ( existing && existingRef && existing.state.model.id === config.model ) {
		return { agent: existing, lifecycleRef: existingRef };
	}

	const model = buildModel( config.model, baseURL, extraHeaders );

	const systemPrompt = buildSystemPrompt(
		config.activeSite?.remote && config.activeSite?.wpcomSiteId
			? {
					remoteSite: {
						name: config.activeSite.name,
						url: config.activeSite.url ?? '',
						id: config.activeSite.wpcomSiteId,
					},
			  }
			: undefined
	);

	const tools = buildAgentTools( config );

	// Source the seed transcript: in-memory if we're swapping models on a
	// running session, otherwise from the sidecar (cold start).
	const initialMessages = existing
		? existing.state.messages
		: config.sessionFilePath
		? ( await loadSidecar( config.sessionFilePath ) ) ?? []
		: [];

	const lifecycleRef: CompactionLifecycleRef = { current: null };

	const agent = new Agent( {
		initialState: {
			model,
			systemPrompt,
			messages: initialMessages,
			tools,
		},
		getApiKey: () => apiKey,
		sessionId,
		transformContext: buildTransformContext( {
			model,
			apiKey,
			headers: extraHeaders,
			// Stable closure that defers to whatever handler the current
			// `createMessageStream` plugged in. See the doc-block on
			// `CompactionLifecycleRef`.
			onLifecycle: ( phase ) => lifecycleRef.current?.( phase ),
		} ),
	} );

	AGENTS_BY_SESSION.set( sessionId, agent );
	LIFECYCLE_REFS_BY_SESSION.set( sessionId, lifecycleRef );
	return { agent, lifecycleRef };
}

/**
 * Construct the pi-ai `Model` for the wpcom proxy.
 *
 * We route OpenAI calls through Chat Completions (`/v1/chat/completions`).
 * The only OpenAI model we expose today is `gpt-5.5`, which works cleanly
 * on this path — no reasoning hop, no per-model thinking-level tuning, no
 * tool-loop terminating early on empty content.
 *
 * Pro / o-series variants would require `/v1/responses` (and were removed
 * from `AI_MODELS` because the reasoning step ran past the proxy / SDK
 * timeout). If/when we want to re-add them we'd either restore the
 * Responses path here keyed by model id, or solve the timeout server-side.
 */
function buildModel(
	modelId: string,
	baseURL: string,
	extraHeaders: Record< string, string > | undefined
): Model< 'openai-completions' > {
	return {
		id: modelId,
		name: modelId,
		api: 'openai-completions',
		provider: 'openai',
		baseUrl: baseURL.replace( /\/+$/, '' ),
		reasoning: false,
		input: [ 'text' ],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 16_384,
		...( extraHeaders ? { headers: extraHeaders } : {} ),
	};
}

function buildAgentTools( config: AgentRuntimeConfig ) {
	const isRemoteSite = Boolean(
		config.activeSite?.remote && config.activeSite?.wpcomSiteId && config.wpcomAccessToken
	);

	// AskUserQuestion only makes sense interactively — only register it when the
	// runtime config provides an onAskUser callback (i.e. a UI is connected).
	const askUserTool: SdkMcpToolDefinition[] = config.onAskUser
		? [ createAskUserQuestionTool( config.onAskUser ) ]
		: [];

	// Skill tool — mirrors the Anthropic SDK's built-in Skill tool. Gives the
	// model a way to load workflow runbooks (e.g. `site-spec`) on demand
	// instead of having every body inlined into the system prompt.
	const skillToolDef = createSkillTool();
	const skillTool: SdkMcpToolDefinition[] = skillToolDef ? [ skillToolDef ] : [];

	if ( isRemoteSite ) {
		const defs = [
			createWpcomRequestTool( config.wpcomAccessToken!, config.activeSite!.wpcomSiteId! ),
			takeScreenshotTool,
			createSiteTool,
			pullSiteTool,
			...askUserTool,
			...skillTool,
		] as unknown as SdkMcpToolDefinition[];
		return adaptToolsForPi( defs );
	}

	// Local site: adapted studio tools + pi's native coding tools (Read/Write/
	// Edit/Bash/Grep/Glob/Ls). The pi tools are already AgentTool instances so
	// they skip the zod → typebox adapter. The `Glob` / `Ls` naming keeps the
	// tool names consistent with Claude Code's preset, so the system prompt
	// doesn't need to know which runtime is serving the turn.
	const studioTools = adaptToolsForPi( [
		...studioToolDefinitions,
		...askUserTool,
		...skillTool,
	] as unknown as SdkMcpToolDefinition[] );
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
	return [ ...studioTools, ...piTools ];
}

/**
 * Maps pi's AgentEvent stream into the synthetic SDKMessage shape the UI
 * (ui.ts) already knows how to render. The important events:
 *
 * - `turn_end` emits one assistant message (possibly with tool calls) plus
 *   tool results. We yield one `SDKAssistantMessage` per tool-call block and
 *   one `SDKUserMessage` per tool result.
 * - `message_end` covers the pure-text case (no tools).
 * - `agent_end` closes the turn with a success result.
 */
function* translateEvent(
	event: AgentEvent,
	sessionId: string,
	model: string,
	start: number
): Generator< SDKMessage, void, void > {
	if ( event.type === 'message_end' ) {
		const msg = event.message;
		if ( msg.role !== 'assistant' ) return;
		const text = extractAssistantText( msg );
		const toolCalls = msg.content.filter(
			( block ): block is Extract< typeof block, { type: 'toolCall' } > => block.type === 'toolCall'
		);
		if ( text ) {
			yield makeAssistantText( sessionId, model, text );
		} else if ( toolCalls.length === 0 ) {
			// Defensive fallback: when reasoning models burn the whole turn on
			// thinking and produce no text *and* no tool calls (seen with low
			// reasoning effort + simple prompts), pi delivers a message whose
			// content is only `thinking` blocks. Without this branch the UI
			// would render an empty turn ("Done" with no body) and the user
			// would think the agent did nothing. Surface the thinking summary
			// instead so at least the model's reasoning is visible.
			const thinking = extractThinkingText( msg );
			if ( thinking ) {
				yield makeAssistantText( sessionId, model, thinking );
			}
		}
		for ( const block of toolCalls ) {
			yield makeAssistantToolUse(
				sessionId,
				model,
				block.id,
				block.name,
				( block.arguments as Record< string, unknown > ) ?? {}
			);
		}
		return;
	}
	if ( event.type === 'turn_end' ) {
		for ( const toolResult of event.toolResults ) {
			const text = extractToolResultText( toolResult );
			yield makeToolResult( sessionId, toolResult.toolCallId, text, Boolean( toolResult.isError ) );
		}
		return;
	}
	if ( event.type === 'agent_end' ) {
		yield makeResultSuccess( sessionId, '', start );
		return;
	}
}

function extractAssistantText( msg: AgentMessage ): string {
	if ( msg.role !== 'assistant' ) return '';
	return msg.content
		.filter( ( b ): b is { type: 'text'; text: string } => b.type === 'text' )
		.map( ( b ) => b.text )
		.join( '' );
}

/**
 * Concatenate any `thinking` block text from an assistant message. Used as a
 * last-resort fallback in `translateEvent` when a turn ends without text or
 * tool calls — better to show the model's reasoning summary than nothing.
 */
function extractThinkingText( msg: AgentMessage ): string {
	if ( msg.role !== 'assistant' ) return '';
	return msg.content
		.filter(
			( b ): b is { type: 'thinking'; thinking: string } =>
				b.type === 'thinking' && typeof ( b as { thinking?: unknown } ).thinking === 'string'
		)
		.map( ( b ) => b.thinking )
		.join( '\n\n' );
}

function extractToolResultText( toolResult: {
	content: Array< { type: string; text?: string } | unknown >;
} ): string {
	if ( ! Array.isArray( toolResult.content ) ) return '';
	return toolResult.content
		.map( ( part ) => {
			if ( ! part || typeof part !== 'object' ) return String( part );
			const p = part as { type?: string; text?: string };
			if ( p.type === 'text' && typeof p.text === 'string' ) return p.text;
			return '';
		} )
		.join( '' );
}

function parseHeaderEnv( value: string | undefined ): Record< string, string > | undefined {
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
		// JSON.parse failed. Surface a warning so a missing X-WPCOM-AI-Feature
		// header doesn't show up later as an opaque 401 from the proxy.
		console.warn(
			'STUDIO_OPENAI_DEFAULT_HEADERS contained malformed JSON; ignoring custom headers.'
		);
	}
	return undefined;
}

function makeSystemInit( sessionId: string, model: string ): SDKMessage {
	return {
		type: 'system',
		subtype: 'init',
		apiKeySource: 'user',
		cwd: STUDIO_SITES_ROOT,
		tools: [],
		mcp_servers: [],
		model,
		permissionMode: 'default',
		slash_commands: [],
		output_style: 'default',
		skills: [],
		plugins: [],
		claude_code_version: '0.0.0-openai-poc',
		uuid: crypto.randomUUID(),
		session_id: sessionId,
	} as unknown as SDKMessage;
}

/**
 * Synthesize a `system.status` SDKMessage. The desktop UI (`ui.ts:2243-2249`)
 * renders `subtype === 'status' && status === 'compacting'` as a "Compacting
 * conversation history…" loader. Used at the start of a compaction round so
 * the user sees that the runtime is doing work before the next turn lands.
 */
function makeSystemStatus( sessionId: string, status: 'compacting' ): SDKMessage {
	return {
		type: 'system',
		subtype: 'status',
		status,
		uuid: crypto.randomUUID(),
		session_id: sessionId,
	} as unknown as SDKMessage;
}

/**
 * Synthesize a `system.compact_boundary` SDKMessage. The desktop UI renders
 * this as a "Conversation history compacted" notice and the recorder
 * persists it to the JSONL — same shape the Claude Agent SDK emits natively
 * when its built-in compaction fires, so on-screen and on-disk surfaces
 * agree.
 */
function makeCompactBoundary( sessionId: string ): SDKMessage {
	return {
		type: 'system',
		subtype: 'compact_boundary',
		uuid: crypto.randomUUID(),
		session_id: sessionId,
	} as unknown as SDKMessage;
}

function makeAssistantText( sessionId: string, model: string, text: string ): SDKMessage {
	return {
		type: 'assistant',
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: sessionId,
		message: {
			id: crypto.randomUUID(),
			type: 'message',
			role: 'assistant',
			model,
			content: [ { type: 'text', text } ],
			stop_reason: 'end_turn',
			stop_sequence: null,
			usage: {
				input_tokens: 0,
				output_tokens: 0,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				service_tier: 'standard',
			},
		},
	} as unknown as SDKMessage;
}

function makeAssistantToolUse(
	sessionId: string,
	model: string,
	toolUseId: string,
	toolName: string,
	input: Record< string, unknown >
): SDKMessage {
	return {
		type: 'assistant',
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: sessionId,
		message: {
			id: crypto.randomUUID(),
			type: 'message',
			role: 'assistant',
			model,
			content: [ { type: 'tool_use', id: toolUseId, name: toolName, input } ],
			stop_reason: 'tool_use',
			stop_sequence: null,
			usage: {
				input_tokens: 0,
				output_tokens: 0,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				service_tier: 'standard',
			},
		},
	} as unknown as SDKMessage;
}

function makeToolResult(
	sessionId: string,
	toolUseId: string,
	content: string,
	isError: boolean
): SDKMessage {
	return {
		type: 'user',
		parent_tool_use_id: null,
		uuid: crypto.randomUUID(),
		session_id: sessionId,
		message: {
			role: 'user',
			content: [
				{
					type: 'tool_result',
					tool_use_id: toolUseId,
					content,
					is_error: isError,
				},
			],
		},
	} as unknown as SDKMessage;
}

function makeResultSuccess( sessionId: string, text: string, start: number ): SDKMessage {
	const durationMs = Date.now() - start;
	return {
		type: 'result',
		subtype: 'success',
		duration_ms: durationMs,
		duration_api_ms: durationMs,
		is_error: false,
		num_turns: 1,
		result: text,
		stop_reason: 'end_turn',
		total_cost_usd: 0,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			server_tool_use: { web_search_requests: 0 },
			service_tier: 'standard',
		},
		modelUsage: {},
		permission_denials: [],
		uuid: crypto.randomUUID(),
		session_id: sessionId,
	} as unknown as SDKMessage;
}

function makeResultError( sessionId: string, start: number ): SDKMessage {
	const durationMs = Date.now() - start;
	return {
		type: 'result',
		subtype: 'error_during_execution',
		duration_ms: durationMs,
		duration_api_ms: durationMs,
		is_error: true,
		num_turns: 0,
		result: '',
		stop_reason: null,
		total_cost_usd: 0,
		usage: {
			input_tokens: 0,
			output_tokens: 0,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			server_tool_use: { web_search_requests: 0 },
			service_tier: 'standard',
		},
		modelUsage: {},
		permission_denials: [],
		uuid: crypto.randomUUID(),
		session_id: sessionId,
	} as unknown as SDKMessage;
}
