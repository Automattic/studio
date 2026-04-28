import crypto from 'crypto';
import {
	Agent,
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
	type BeforeToolCallContext,
	type BeforeToolCallResult,
} from '@mariozechner/pi-agent-core';
import { calculateCost } from '@mariozechner/pi-ai';
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from '@mariozechner/pi-coding-agent';
import {
	isAiModelId,
	getAiModelFamily,
	type AiModelFamily,
	type AiModelId,
} from '@studio/common/ai/models';
import {
	ACCESS_DENIED_MESSAGE,
	STUDIO_ROOT,
	findFirstPathOutsideTrustedRoots,
	isPathGatedTool,
	resolveToolPath,
} from 'cli/ai/security';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { studioToolDefinitions } from 'cli/ai/tools';
import { createAskUserQuestionTool } from 'cli/ai/tools/ask-user-question';
import { createSiteTool } from 'cli/ai/tools/create-site';
import { pullSiteTool } from 'cli/ai/tools/pull-site';
import { takeScreenshotTool } from 'cli/ai/tools/take-screenshot';
import { createWpcomRequestTool } from 'cli/ai/tools/wpcom-request';
import { buildTransformContext } from './compaction';
import { loadSidecar, saveSidecar } from './persistence';
import { adaptToolsForPi } from './pi-tool-adapter';
import { buildSkillsAppendix } from './skill-loader';
import type { AgentRuntime, AgentRuntimeConfig, AgentRuntimeHandle } from '../types';
import type { Api, AssistantMessage, Model, Usage } from '@mariozechner/pi-ai';
import type { SDKMessage, SdkMcpToolDefinition } from 'cli/ai/sdk-message-types';

/**
 * Unified pi runtime.
 *
 * One agent loop (`@mariozechner/pi-agent-core`) wired against pi-ai's
 * provider-agnostic `Model<Api>` interface. The model id picked from the UI
 * decides which underlying API the runtime targets — `anthropic-messages`
 * for Claude models, `openai-completions` for GPT models — but the loop, the
 * tool adapter, the transcript persistence, and the synthetic SDKMessage
 * stream are shared.
 *
 * Session persistence is baked in: an `Agent` owns its transcript, and
 * successive `prompt()` calls append to it. We keep Agents in a module-scoped
 * Map keyed by our session id so `config.resume` across turns lands back on
 * the same Agent with its full message history.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;

const AGENTS_BY_SESSION = new Map< string, Agent >();

// Per-session usage accumulator used to populate the synthetic `result`
// message. We bucket by model id so a `/model` swap mid-session reports per-
// model breakdowns the same way the Claude Agent SDK did.
interface RunUsage {
	turns: number;
	runtimeError: boolean;
	denials: { tool_name: string; tool_use_id: string; tool_input: Record< string, unknown > }[];
	usageByModel: Map<
		string,
		{
			inputTokens: number;
			outputTokens: number;
			cacheReadInputTokens: number;
			cacheCreationInputTokens: number;
			costUSD: number;
			webSearchRequests: number;
		}
	>;
}

function newRunUsage(): RunUsage {
	return { turns: 0, runtimeError: false, denials: [], usageByModel: new Map() };
}

export const piRuntime: AgentRuntime = {
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
	// Defensive lookup. `getAiModelFamily` errors on ids that aren't in
	// `AI_MODELS`; we'd rather assume Anthropic for unknown ids (the only
	// non-OpenAI family today) than crash the runtime. Real production
	// dispatch always feeds in a registered id, so this just keeps tests and
	// any future feature-flagged model rollouts from blowing up the loop.
	const family: AiModelFamily = isAiModelId( config.model )
		? getAiModelFamily( config.model )
		: String( config.model ).startsWith( 'gpt' )
		? 'openai'
		: 'anthropic';
	yield makeSystemInit( sessionId, config.model );

	let apiKey: string;
	let baseURL: string;
	let extraHeaders: Record< string, string > | undefined;
	try {
		( { apiKey, baseURL, extraHeaders } = resolveModelEnvironment( family, config.env ) );
	} catch ( error ) {
		const message = error instanceof Error ? error.message : String( error );
		yield makeAssistantText( sessionId, config.model, message );
		yield makeResultError( sessionId, config.model, start, newRunUsage() );
		return;
	}

	const usage = newRunUsage();

	try {
		const agent = await getOrCreateAgent(
			sessionId,
			config,
			family,
			baseURL,
			apiKey,
			extraHeaders
		);

		// Emit all SDKMessages produced since we last iterated. pi's event
		// stream is push-based via `subscribe()`, so we bridge to our
		// generator with a simple queue.
		const queue: SDKMessage[] = [];
		const emittedAssistantMessageKeys = new Set< string >();
		const emittedToolCallIds = new Set< string >();
		const emittedToolResultIds = new Set< string >();
		let resolveNext: ( () => void ) | null = null;
		let done = false;

		const unsubscribe = agent.subscribe( ( event ) => {
			for ( const msg of translateEvent(
				event,
				sessionId,
				config.model,
				usage,
				emittedAssistantMessageKeys,
				emittedToolCallIds,
				emittedToolResultIds
			) ) {
				queue.push( msg );
			}
			if ( event.type === 'agent_end' ) {
				done = true;
			}
			resolveNext?.();
			resolveNext = null;
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
		await runPromise.catch( () => undefined );

		// Persist the post-turn transcript so the next CLI fork can resume.
		// Best-effort: failure to write doesn't abort the (already finished)
		// turn — the run still appears successful to the caller and the user.
		// The next fork would just start with empty memory in the worst case.
		if ( config.sessionFilePath ) {
			await saveSidecar( config.sessionFilePath, agent.state.messages ).catch( () => undefined );
		}

		// Emit the result *after* persistence so the UI's "Done"
		// message lines up with the durable state on disk.
		yield usage.runtimeError
			? makeResultError( sessionId, config.model, start, usage )
			: makeResultSuccess( sessionId, config.model, start, usage );
	} catch ( error ) {
		if ( controller.signal.aborted ) {
			yield makeResultError( sessionId, config.model, start, usage );
			return;
		}
		const message = error instanceof Error ? error.message : String( error );
		yield makeAssistantText( sessionId, config.model, `pi runtime error: ${ message }` );
		yield makeResultError( sessionId, config.model, start, usage );
	}
}

/**
 * Resolve the apiKey + baseURL + extra headers for the active model family.
 * Throws a `LoggerError`-style message string when required env is missing —
 * the caller surfaces it as an assistant text + error result so the user
 * sees what to fix without a process crash.
 */
function resolveModelEnvironment(
	family: AiModelFamily,
	env: Record< string, string >
): { apiKey: string; baseURL: string; extraHeaders: Record< string, string > | undefined } {
	if ( family === 'openai' ) {
		const apiKey = env.OPENAI_API_KEY?.trim();
		if ( ! apiKey ) {
			throw new Error(
				'OpenAI provider selected but OPENAI_API_KEY is not set. On the WordPress.com provider this means the wpcom access token is missing — run /login to authenticate.'
			);
		}
		const baseURL = env.OPENAI_BASE_URL?.trim();
		if ( ! baseURL ) {
			throw new Error( 'OPENAI_BASE_URL not set — cannot route to wpcom proxy.' );
		}
		return {
			apiKey,
			baseURL,
			extraHeaders: parseJsonHeaderEnv( env.STUDIO_OPENAI_DEFAULT_HEADERS ),
		};
	}

	// Anthropic family. `ANTHROPIC_AUTH_TOKEN` is what `providers.ts` writes
	// when the credential is the wpcom access token (Bearer auth on the proxy).
	// `ANTHROPIC_API_KEY` is what it writes when the user supplied a direct
	// Anthropic API key — same code path on our side, pi-ai's anthropic
	// provider auto-picks the auth header style based on the token format.
	const apiKey = ( env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY )?.trim();
	if ( ! apiKey ) {
		throw new Error(
			'Anthropic provider selected but no auth credentials are set. On the WordPress.com provider this means the wpcom access token is missing — run /login to authenticate.'
		);
	}
	// Direct API requests skip the wpcom proxy; pi-ai's Anthropic model has a
	// sensible default `baseUrl` of https://api.anthropic.com, so we only
	// override when one is supplied.
	const baseURL = env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com';
	const authToken = env.ANTHROPIC_AUTH_TOKEN?.trim();
	const extraHeaders = {
		...( parseColonHeaderEnv( env.ANTHROPIC_CUSTOM_HEADERS ) ?? {} ),
		...( authToken ? { Authorization: `Bearer ${ authToken }` } : {} ),
	};
	return {
		apiKey,
		baseURL,
		extraHeaders: Object.keys( extraHeaders ).length ? extraHeaders : undefined,
	};
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
	family: AiModelFamily,
	baseURL: string,
	apiKey: string,
	extraHeaders: Record< string, string > | undefined
): Promise< Agent > {
	const existing = AGENTS_BY_SESSION.get( sessionId );
	if ( existing && existing.state.model.id === config.model ) {
		return existing;
	}

	const model = buildModel( family, config.model, baseURL, extraHeaders );

	const isRemoteSite = Boolean(
		config.activeSite?.remote && config.activeSite?.wpcomSiteId && config.wpcomAccessToken
	);
	const isForkedByDesktop = typeof process.send === 'function';

	const basePrompt = buildSystemPrompt(
		isRemoteSite
			? {
					remoteSite: {
						name: config.activeSite!.name,
						url: config.activeSite!.url ?? '',
						id: config.activeSite!.wpcomSiteId!,
					},
			  }
			: { previewSteering: isForkedByDesktop }
	);
	const skillsAppendix = buildSkillsAppendix();
	const systemPrompt = skillsAppendix ? `${ basePrompt }\n\n${ skillsAppendix }` : basePrompt;

	const tools = buildAgentTools( config, isRemoteSite, isForkedByDesktop );

	// Source the seed transcript: in-memory if we're swapping models on a
	// running session, otherwise from the sidecar (cold start).
	const initialMessages = existing
		? existing.state.messages
		: config.sessionFilePath
		? ( await loadSidecar( config.sessionFilePath ) ) ?? []
		: [];

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
		} ),
		beforeToolCall: buildBeforeToolCall(),
	} );

	AGENTS_BY_SESSION.set( sessionId, agent );
	return agent;
}

/**
 * Construct the pi-ai `Model` for the active dispatch.
 *
 * Anthropic family: `anthropic-messages` API. pi-ai's anthropic provider
 * already handles interleaved thinking, prompt caching, the OAuth-vs-API-key
 * header flip, and Claude Code stealth tool naming. We pass our explicit
 * headers through `model.headers` so the provider merges them with its own
 * defaults — important on the wpcom path where the proxy needs an
 * `X-WPCOM-AI-Feature` header to route the request.
 *
 * OpenAI family: `openai-completions` API (`/v1/chat/completions`). The only
 * OpenAI model we expose today is `gpt-5.5`, which works cleanly on this
 * path — no reasoning hop, no per-model thinking-level tuning, no tool-loop
 * terminating early on empty content. Pro / o-series variants would require
 * `/v1/responses` (and were removed from `AI_MODELS` because the reasoning
 * step ran past the proxy / SDK timeout). If/when we want to re-add them
 * we'd either restore the Responses path here keyed by model id, or solve
 * the timeout server-side.
 *
 * `cost` is left at zero. We compute per-turn cost ourselves in the
 * `result` message synth path using pi-ai's `calculateCost` against the
 * full per-million rate from the model registry — which we can't enumerate
 * here without bloating this file.
 */
function buildModel(
	family: AiModelFamily,
	modelId: AiModelId,
	baseURL: string,
	extraHeaders: Record< string, string > | undefined
): Model< Api > {
	const trimmedBaseUrl = baseURL.replace( /\/+$/, '' );

	if ( family === 'anthropic' ) {
		return {
			id: modelId,
			name: modelId,
			api: 'anthropic-messages',
			provider: 'anthropic',
			baseUrl: trimmedBaseUrl,
			// Opus / Sonnet 4.6+ all support extended thinking. Enabling
			// reasoning here lets pi-ai send the interleaved-thinking beta
			// header (where applicable) and request adaptive thinking
			// budgets. For non-thinking-capable Claude variants this is a
			// no-op.
			reasoning: true,
			input: [ 'text', 'image' ],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 200_000,
			maxTokens: 16_384,
			...( extraHeaders ? { headers: extraHeaders } : {} ),
		};
	}

	return {
		id: modelId,
		name: modelId,
		api: 'openai-completions',
		provider: 'openai',
		baseUrl: trimmedBaseUrl,
		reasoning: false,
		input: [ 'text' ],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 16_384,
		...( extraHeaders ? { headers: extraHeaders } : {} ),
	};
}

function buildAgentTools(
	config: AgentRuntimeConfig,
	isRemoteSite: boolean,
	isForkedByDesktop: boolean
): AgentToolAny[] {
	// AskUserQuestion only makes sense interactively — only register it when the
	// runtime config provides an onAskUser callback (i.e. a UI is connected).
	const askUserTool: SdkMcpToolDefinition[] = config.onAskUser
		? [ createAskUserQuestionTool( config.onAskUser ) ]
		: [];

	if ( isRemoteSite ) {
		const defs = [
			createWpcomRequestTool( config.wpcomAccessToken!, config.activeSite!.wpcomSiteId! ),
			takeScreenshotTool,
			createSiteTool,
			pullSiteTool,
			...askUserTool,
		] as unknown as SdkMcpToolDefinition[];
		return adaptToolsForPi( defs );
	}

	// Local site: adapted studio tools + pi's native coding tools (Read/Write/
	// Edit/Bash/Grep/Glob/Ls). The pi tools are already AgentTool instances so
	// they skip the zod → typebox adapter. The `Glob` / `Ls` naming keeps the
	// tool names consistent with Claude Code's preset, so the system prompt
	// doesn't need to know which runtime is serving the turn.
	//
	// Filter preview-steering tools when not forked by desktop — same gate the
	// Anthropic runtime used (see `runtimes/anthropic` history).
	const previewSteeringNames = new Set( [ 'preview_navigate', 'preview_reload' ] );
	const filteredStudioTools = isForkedByDesktop
		? studioToolDefinitions
		: studioToolDefinitions.filter( ( t ) => ! previewSteeringNames.has( t.name ) );

	const studioTools = adaptToolsForPi( [
		...filteredStudioTools,
		...askUserTool,
	] as unknown as SdkMcpToolDefinition[] );
	const renameTool = ( tool: AgentToolAny, name: string ): AgentToolAny => ( {
		...tool,
		name,
		label: name,
	} );

	const piTools: AgentToolAny[] = [
		renameTool( createReadTool( STUDIO_ROOT ), 'Read' ),
		renameTool( createWriteTool( STUDIO_ROOT ), 'Write' ),
		renameTool( createEditTool( STUDIO_ROOT ), 'Edit' ),
		renameTool( createBashTool( STUDIO_ROOT ), 'Bash' ),
		renameTool( createGrepTool( STUDIO_ROOT ), 'Grep' ),
		renameTool( createFindTool( STUDIO_ROOT ), 'Glob' ),
		renameTool( createLsTool( STUDIO_ROOT ), 'Ls' ),
	];
	return [ ...studioTools, ...piTools ];
}

/**
 * Build the `beforeToolCall` callback pi-agent-core invokes after argument
 * validation, just before tool execution. We use it to gate path-touching
 * tools (Write/Edit/NotebookEdit) so they can't reach outside the trusted
 * roots — `STUDIO_ROOT` plus the OS tmp directories. Bash is intentionally
 * not gated here (its `command` arg isn't a structured path; static
 * classification is the wrong shape of safety net for arbitrary shell —
 * see `apps/cli/ai/security.ts`).
 *
 * No prompt: the SDK's `permissionMode: 'auto'` classifier (which trunk used
 * pre-unification) had no equivalent on pi-agent-core, and re-implementing
 * the old allow-once / allow-always / deny UX adds host complexity in the
 * other direction trunk simplified away. We just refuse silently with a
 * stable message — `pi` synthesizes an error tool result the model can
 * recover from on the next turn (e.g. "write inside ~/Studio instead").
 *
 * Returns `{ block: true, reason }` to refuse, `undefined` to allow.
 */
function buildBeforeToolCall(): (
	ctx: BeforeToolCallContext
) => Promise< BeforeToolCallResult | undefined > {
	return async ( ctx ) => {
		const toolName = ctx.toolCall.name;
		if ( ! isPathGatedTool( toolName ) ) {
			return undefined;
		}
		const input =
			ctx.args && typeof ctx.args === 'object' ? ( ctx.args as Record< string, unknown > ) : {};
		const outsidePath = findFirstPathOutsideTrustedRoots( input );
		if ( outsidePath ) {
			return {
				block: true,
				reason: `${ ACCESS_DENIED_MESSAGE }: ${ resolveToolPath( outsidePath ) }`,
			};
		}
		return undefined;
	};
}

/**
 * Maps pi's AgentEvent stream into the synthetic SDKMessage shape the UI
 * (ui.ts) already knows how to render. The important events:
 *
 * - `tool_execution_start` / `tool_execution_end` emit tool-use and tool-result
 *   SDKMessages as the work happens, so the UI/recorder can measure real tool
 *   duration instead of reconstructing it from bundled end-of-turn artifacts.
 * - `turn_end` emits one assistant message (possibly with tool calls) plus
 *   tool results. We use it as a fallback for artifacts not already emitted by
 *   the streaming tool execution events, and accumulate per-turn usage here so
 *   the synthetic `result` message can report real numbers.
 * - `message_end` covers the pure-text case (no tools).
 * - `agent_end` we treat as a no-op for emission; the success result is
 *   synthesized after persistence, in `createMessageStream`.
 */
function* translateEvent(
	event: AgentEvent,
	sessionId: string,
	currentModel: AiModelId,
	usage: RunUsage,
	emittedAssistantMessageKeys: Set< string >,
	emittedToolCallIds: Set< string >,
	emittedToolResultIds: Set< string >
): Generator< SDKMessage, void, void > {
	if ( event.type === 'tool_execution_start' ) {
		if ( emittedToolCallIds.has( event.toolCallId ) ) {
			return;
		}
		emittedToolCallIds.add( event.toolCallId );
		yield makeAssistantToolUse(
			sessionId,
			currentModel,
			event.toolCallId,
			event.toolName,
			( event.args as Record< string, unknown > ) ?? {}
		);
		return;
	}
	if ( event.type === 'tool_execution_end' ) {
		if ( emittedToolResultIds.has( event.toolCallId ) ) {
			return;
		}
		emittedToolResultIds.add( event.toolCallId );
		yield makeToolResult(
			sessionId,
			event.toolCallId,
			extractToolResultText( event.result ),
			Boolean( event.isError )
		);
		return;
	}
	if ( event.type === 'message_end' ) {
		yield* emitAssistantMessage(
			event.message,
			sessionId,
			currentModel,
			usage,
			emittedAssistantMessageKeys,
			emittedToolCallIds
		);
		return;
	}
	if ( event.type === 'turn_end' ) {
		usage.turns += 1;
		const maybeMessage = ( event as { message?: AgentMessage } ).message;
		if ( maybeMessage ) {
			yield* emitAssistantMessage(
				maybeMessage,
				sessionId,
				currentModel,
				usage,
				emittedAssistantMessageKeys,
				emittedToolCallIds
			);
		}
		for ( const toolResult of event.toolResults ) {
			if ( emittedToolResultIds.has( toolResult.toolCallId ) ) {
				continue;
			}
			emittedToolResultIds.add( toolResult.toolCallId );
			const text = extractToolResultText( toolResult );
			if ( toolResult.isError ) {
				// pi reports a permission denial as an error tool result with
				// the deny reason inline. Mirror what the Claude Agent SDK
				// reported in `permission_denials` so the UI's existing error
				// rendering keeps working. We can't tell *every* error apart
				// from a denial here — we pattern-match on the access-denied
				// text the security layer emits.
				if ( text.includes( 'Access denied outside trusted directories' ) ) {
					usage.denials.push( {
						tool_name: toolResult.toolName,
						tool_use_id: toolResult.toolCallId,
						tool_input: {},
					} );
				}
			}
			yield makeToolResult( sessionId, toolResult.toolCallId, text, Boolean( toolResult.isError ) );
		}
		return;
	}
}

function* emitAssistantMessage(
	msg: AgentMessage,
	sessionId: string,
	currentModel: AiModelId,
	usage: RunUsage,
	emittedAssistantMessageKeys: Set< string >,
	emittedToolCallIds: Set< string >
): Generator< SDKMessage, void, void > {
	if ( msg.role !== 'assistant' ) return;
	const messageKey = assistantMessageKey( msg );
	if ( emittedAssistantMessageKeys.has( messageKey ) ) {
		return;
	}
	emittedAssistantMessageKeys.add( messageKey );
	recordUsage( msg, usage );
	if ( isAssistantError( msg ) ) {
		usage.runtimeError = true;
	}
	const text = extractAssistantText( msg );
	const thinkingBlocks = extractThinkingBlocks( msg );
	const toolCalls = msg.content.filter(
		( block ): block is Extract< typeof block, { type: 'toolCall' } > => block.type === 'toolCall'
	);
	// Yield thinking content first so the desktop UI can render the "thinking"
	// affordance before any text or tool calls land.
	for ( const block of thinkingBlocks ) {
		yield makeAssistantThinking( sessionId, currentModel, block.thinking, block.signature );
	}
	if ( text ) {
		yield makeAssistantText( sessionId, currentModel, text );
	} else if ( toolCalls.length === 0 && thinkingBlocks.length === 0 ) {
		// Empty turn fallback: nothing to render. Skip silently — the `result`
		// message still closes the turn so the UI doesn't hang.
	}
	for ( const block of toolCalls ) {
		if ( emittedToolCallIds.has( block.id ) ) {
			continue;
		}
		emittedToolCallIds.add( block.id );
		yield makeAssistantToolUse(
			sessionId,
			currentModel,
			block.id,
			block.name,
			( block.arguments as Record< string, unknown > ) ?? {}
		);
	}
}

function assistantMessageKey( msg: AgentMessage ): string {
	if ( msg.role !== 'assistant' ) {
		return JSON.stringify( { role: msg.role } );
	}
	return JSON.stringify( {
		role: msg.role,
		content: msg.content,
		model: 'model' in msg ? msg.model : undefined,
		stopReason: 'stopReason' in msg ? msg.stopReason : undefined,
	} );
}

function isAssistantError( msg: AgentMessage ): boolean {
	return msg.role === 'assistant' && 'stopReason' in msg && msg.stopReason === 'error';
}

function recordUsage( msg: AssistantMessage, usage: RunUsage ): void {
	const u: Usage | undefined = msg.usage;
	if ( ! u ) return;
	const modelId = msg.model || 'unknown';
	const existing = usage.usageByModel.get( modelId ) ?? {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadInputTokens: 0,
		cacheCreationInputTokens: 0,
		costUSD: 0,
		webSearchRequests: 0,
	};
	existing.inputTokens += u.input ?? 0;
	existing.outputTokens += u.output ?? 0;
	existing.cacheReadInputTokens += u.cacheRead ?? 0;
	existing.cacheCreationInputTokens += u.cacheWrite ?? 0;
	existing.costUSD += u.cost?.total ?? 0;
	usage.usageByModel.set( modelId, existing );
}

function extractAssistantText( msg: AgentMessage ): string {
	if ( msg.role !== 'assistant' ) return '';
	return msg.content
		.filter( ( b ): b is { type: 'text'; text: string } => b.type === 'text' )
		.map( ( b ) => b.text )
		.join( '' );
}

/**
 * Pull every `thinking` block out of an assistant message so the runtime can
 * surface them as proper `thinking` content blocks in the synthetic SDK
 * messages. Preserves the encrypted `thinkingSignature` on each block under
 * the `signature` key — the desktop UI's renderer expects that name (mirroring
 * the Claude Agent SDK's `thinking` block shape).
 */
function extractThinkingBlocks(
	msg: AgentMessage
): Array< { thinking: string; signature: string } > {
	if ( msg.role !== 'assistant' ) return [];
	return msg.content
		.filter(
			( b ): b is { type: 'thinking'; thinking: string; thinkingSignature?: string } =>
				b.type === 'thinking' && typeof ( b as { thinking?: unknown } ).thinking === 'string'
		)
		.map( ( b ) => ( {
			thinking: b.thinking,
			signature: b.thinkingSignature ?? '',
		} ) );
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

/**
 * Parse `STUDIO_OPENAI_DEFAULT_HEADERS`-style JSON-encoded header maps.
 * Returns undefined when the env is unset or malformed — the runtime then
 * falls back to whatever defaults pi-ai provides for the model.
 */
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
	} catch {
		// Ignore malformed JSON — fall back to no custom headers.
	}
	return undefined;
}

/**
 * Parse `ANTHROPIC_CUSTOM_HEADERS`-style colon-delimited header lists. Format:
 *   Header-Name: value\n
 *   Other-Header: other value
 * mirroring how `apps/cli/ai/providers.ts` writes them (`buildAnthropicCustomHeaders`).
 */
function parseColonHeaderEnv( value: string | undefined ): Record< string, string > | undefined {
	if ( ! value ) return undefined;
	const headers: Record< string, string > = {};
	for ( const line of value.split( /\r?\n/ ) ) {
		const trimmed = line.trim();
		if ( ! trimmed ) continue;
		const colonIndex = trimmed.indexOf( ':' );
		if ( colonIndex === -1 ) continue;
		const name = trimmed.slice( 0, colonIndex ).trim();
		const headerValue = trimmed.slice( colonIndex + 1 ).trim();
		if ( name && headerValue ) {
			headers[ name ] = headerValue;
		}
	}
	return Object.keys( headers ).length ? headers : undefined;
}

function makeSystemInit( sessionId: string, model: AiModelId ): SDKMessage {
	return {
		type: 'system',
		subtype: 'init',
		apiKeySource: 'user',
		cwd: STUDIO_ROOT,
		tools: [],
		mcp_servers: [],
		model,
		permissionMode: 'default',
		slash_commands: [],
		output_style: 'default',
		skills: [],
		plugins: [],
		claude_code_version: '0.0.0-pi',
		uuid: crypto.randomUUID(),
		session_id: sessionId,
	} as unknown as SDKMessage;
}

function makeAssistantText( sessionId: string, model: AiModelId, text: string ): SDKMessage {
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
			usage: zeroUsageBlock(),
		},
	} as unknown as SDKMessage;
}

function makeAssistantThinking(
	sessionId: string,
	model: AiModelId,
	thinking: string,
	signature: string
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
			content: [ { type: 'thinking', thinking, signature } ],
			stop_reason: 'end_turn',
			stop_sequence: null,
			usage: zeroUsageBlock(),
		},
	} as unknown as SDKMessage;
}

function makeAssistantToolUse(
	sessionId: string,
	model: AiModelId,
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
			usage: zeroUsageBlock(),
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

function zeroUsageBlock() {
	return {
		input_tokens: 0,
		output_tokens: 0,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: 0,
		service_tier: 'standard',
	};
}

function makeResultSuccess(
	sessionId: string,
	model: AiModelId,
	start: number,
	usage: RunUsage
): SDKMessage {
	return makeResult( sessionId, model, start, usage, false );
}

function makeResultError(
	sessionId: string,
	model: AiModelId,
	start: number,
	usage: RunUsage
): SDKMessage {
	return makeResult( sessionId, model, start, usage, true );
}

/**
 * Build the synthetic `result` SDKMessage with real cost / token / turn /
 * denial figures pulled from the per-run accumulator.
 *
 * `total_cost_usd` is the sum across every model id seen in this run (only
 * one in the typical no-`/model`-swap case). `modelUsage` mirrors the per-
 * model breakdown the SDK used to emit. `permission_denials` is populated by
 * `translateEvent` when a path-gated tool's pre-flight returned `deny`.
 */
function makeResult(
	sessionId: string,
	model: AiModelId,
	start: number,
	usage: RunUsage,
	isError: boolean
): SDKMessage {
	const durationMs = Date.now() - start;
	let totalInput = 0;
	let totalOutput = 0;
	let totalCacheRead = 0;
	let totalCacheWrite = 0;
	let totalCost = 0;
	const modelUsage: Record<
		string,
		{
			inputTokens: number;
			outputTokens: number;
			cacheReadInputTokens: number;
			cacheCreationInputTokens: number;
			webSearchRequests: number;
			costUSD: number;
			contextWindow: number;
		}
	> = {};
	for ( const [ modelId, breakdown ] of usage.usageByModel ) {
		totalInput += breakdown.inputTokens;
		totalOutput += breakdown.outputTokens;
		totalCacheRead += breakdown.cacheReadInputTokens;
		totalCacheWrite += breakdown.cacheCreationInputTokens;
		totalCost += breakdown.costUSD;
		modelUsage[ modelId ] = {
			inputTokens: breakdown.inputTokens,
			outputTokens: breakdown.outputTokens,
			cacheReadInputTokens: breakdown.cacheReadInputTokens,
			cacheCreationInputTokens: breakdown.cacheCreationInputTokens,
			webSearchRequests: breakdown.webSearchRequests,
			costUSD: breakdown.costUSD,
			contextWindow: 0,
		};
	}
	return {
		type: 'result',
		subtype: isError ? 'error_during_execution' : 'success',
		duration_ms: durationMs,
		duration_api_ms: durationMs,
		is_error: isError,
		num_turns: usage.turns,
		result: '',
		stop_reason: isError ? null : 'end_turn',
		total_cost_usd: totalCost,
		usage: {
			input_tokens: totalInput,
			output_tokens: totalOutput,
			cache_creation_input_tokens: totalCacheWrite,
			cache_read_input_tokens: totalCacheRead,
			server_tool_use: { web_search_requests: 0 },
			service_tier: 'standard',
		},
		modelUsage,
		permission_denials: usage.denials,
		uuid: crypto.randomUUID(),
		session_id: sessionId,
	} as unknown as SDKMessage;
}

// `calculateCost` is imported for the side effect of declaring intent —
// we currently rely on pi-ai's own per-stream `usage.cost.total` populated
// inside the anthropic / openai-completions providers. Re-exported here so
// callers (and a future "what if my model registry is wrong" override path)
// have the helper at hand without re-adding the import.
export { calculateCost };
