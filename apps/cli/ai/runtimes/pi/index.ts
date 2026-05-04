import crypto from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import {
	Agent,
	type AgentEvent,
	type AgentMessage,
	type AgentTool,
	type StreamFn,
} from '@mariozechner/pi-agent-core';
import { type Model } from '@mariozechner/pi-ai';
import { streamAnthropic, type AnthropicOptions } from '@mariozechner/pi-ai/anthropic';
import {
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
import { buildTransformContext } from './compaction';
import { loadSidecar, saveSidecar } from './persistence';
import type { SDKMessage } from '../messages';
import type { AgentRuntime, AgentRuntimeConfig, AgentRuntimeHandle } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;

type CompactionPhase = 'start' | 'end' | 'skipped' | 'failed';
interface CompactionLifecycleRef {
	current: ( ( phase: CompactionPhase ) => void ) | null;
}

const AGENTS_BY_SESSION = new Map< string, Agent >();
const LIFECYCLE_REFS_BY_SESSION = new Map< string, CompactionLifecycleRef >();

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

async function* createMessageStream(
	config: AgentRuntimeConfig,
	sessionId: string,
	controller: AbortController
): AsyncGenerator< SDKMessage, void, void > {
	const start = Date.now();
	yield makeSystemInit( sessionId, config.model );

	const family = getAiModelFamily( config.model );
	const resolved = resolveCredentials( family, config.env );
	if ( ! resolved.ok ) {
		yield makeAssistantText( sessionId, config.model, resolved.reason );
		yield makeResultError( sessionId, start );
		return;
	}

	try {
		const { agent, lifecycleRef } = await getOrCreateAgent(
			sessionId,
			config,
			family,
			resolved.creds
		);

		const queue: SDKMessage[] = [];
		let resolveNext: ( () => void ) | null = null;
		let done = false;

		const wake = () => {
			resolveNext?.();
			resolveNext = null;
		};

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
		// Stale closures from previous runs would otherwise keep pushing into a
		// finished queue if a follow-up run reuses the same Agent.
		lifecycleRef.current = null;
		await runPromise.catch( () => undefined );

		if ( config.sessionFilePath ) {
			await saveSidecar( config.sessionFilePath, agent.state.messages ).catch( () => undefined );
		}
	} catch ( error ) {
		if ( controller.signal.aborted ) {
			yield makeResultError( sessionId, start );
			return;
		}
		const message = error instanceof Error ? error.message : String( error );
		yield makeAssistantText( sessionId, config.model, `Runtime error: ${ message }` );
		yield makeResultError( sessionId, start );
	}
}

async function getOrCreateAgent(
	sessionId: string,
	config: AgentRuntimeConfig,
	family: AiModelFamily,
	creds: ResolvedCredentials
): Promise< { agent: Agent; lifecycleRef: CompactionLifecycleRef } > {
	const existing = AGENTS_BY_SESSION.get( sessionId );
	const existingRef = LIFECYCLE_REFS_BY_SESSION.get( sessionId );
	if ( existing && existingRef && existing.state.model.id === config.model ) {
		return { agent: existing, lifecycleRef: existingRef };
	}

	const model = buildModel( config.model, family, creds );

	const isRemoteSite = Boolean( config.activeSite?.remote && config.activeSite?.wpcomSiteId );
	// `process.send` is the same signal `emitEvent` uses to detect the desktop
	// IPC channel; without it, navigate/reload tools are noise in a terminal.
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

	// On a `/model` swap mid-session, reuse the prior transcript so the
	// conversation continues; on a cold fork hydrate from the sidecar.
	const initialMessages = existing
		? existing.state.messages
		: config.sessionFilePath
		? ( await loadSidecar( config.sessionFilePath ) ) ?? []
		: [];

	const lifecycleRef: CompactionLifecycleRef = { current: null };

	// pi-ai's default Anthropic auth uses `apiKey` → `x-api-key`, which the
	// wpcom proxy rejects. Inject a pre-built client with `authToken` so the
	// SDK sends `Authorization: Bearer` instead.
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
			// pi-agent-core defaults to "off"; matches the Claude Agent SDK's
			// previous adaptive-thinking default and gives gpt-5.5 a real
			// reasoning effort budget on Chat Completions.
			thinkingLevel: 'high',
		},
		getApiKey: () => creds.apiKey,
		sessionId,
		...( streamFn ? { streamFn } : {} ),
		transformContext: buildTransformContext( {
			model,
			apiKey: creds.apiKey,
			headers: creds.extraHeaders,
			onLifecycle: ( phase ) => lifecycleRef.current?.( phase ),
		} ),
	} );

	AGENTS_BY_SESSION.set( sessionId, agent );
	LIFECYCLE_REFS_BY_SESSION.set( sessionId, lifecycleRef );
	return { agent, lifecycleRef };
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

	// `reasoning: true` is the capability flag pi-ai checks before sending
	// the reasoning_effort / thinking_budget; the runtime knob lives on
	// `Agent.state.thinkingLevel`.
	if ( family === 'openai' ) {
		return {
			...common,
			api: 'openai-completions',
			provider: 'openai',
			reasoning: true,
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
		// Some test envs (e.g. vitest jsdom) trip the SDK's browser-detect
		// guard; we're in Node.
		dangerouslyAllowBrowser: true,
		defaultHeaders: creds.extraHeaders,
	} );
	// pi-ai bundles its own `@anthropic-ai/sdk` copy; the bundled `Anthropic`
	// class is a different TS identity from ours (private-field branding).
	// Cast through `unknown` since the runtime shape is identical.
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

	// `Glob` / `Ls` mirror Claude Code's preset tool names so the system
	// prompt stays family-agnostic.
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
			// Reasoning models can burn a turn on `thinking` blocks alone; show
			// the summary so the UI doesn't render a silent "Done".
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
		// Surface the warning so a missing X-WPCOM-AI-Feature header doesn't
		// later show up as an opaque 401 from the proxy.
		console.warn(
			'STUDIO_OPENAI_DEFAULT_HEADERS contained malformed JSON; ignoring custom headers.'
		);
	}
	return undefined;
}

// `Name: value\nName: value` — the format `ANTHROPIC_CUSTOM_HEADERS` carries.
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
		claude_code_version: '0.0.0-pi-runtime',
		uuid: crypto.randomUUID(),
		session_id: sessionId,
	} as unknown as SDKMessage;
}

function makeSystemStatus( sessionId: string, status: 'compacting' ): SDKMessage {
	return {
		type: 'system',
		subtype: 'status',
		status,
		uuid: crypto.randomUUID(),
		session_id: sessionId,
	} as unknown as SDKMessage;
}

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
