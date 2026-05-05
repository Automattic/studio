import Anthropic from '@anthropic-ai/sdk';
import { Agent, type AgentEvent, type AgentTool, type StreamFn } from '@mariozechner/pi-agent-core';
import { type Message, type Model, type ToolResultMessage } from '@mariozechner/pi-ai';
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
import type { AgentRuntime, AgentRuntimeConfig, AgentRuntimeHandle } from '../types';
import type { AgentRuntimeEvent, CompactionPhase } from 'cli/ai/runtimes/runtime-events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AgentToolAny = AgentTool< any >;

interface CompactionLifecycleRef {
	current: ( ( phase: CompactionPhase ) => void ) | null;
}

const AGENTS_BY_SESSION = new Map< string, Agent >();
const LIFECYCLE_REFS_BY_SESSION = new Map< string, CompactionLifecycleRef >();

export const piRuntime: AgentRuntime = {
	run( config: AgentRuntimeConfig ): AgentRuntimeHandle {
		const sessionId = config.session.getSessionId();
		const controller = new AbortController();
		const events = createEventStream( config, sessionId, controller );

		return {
			async interrupt() {
				controller.abort();
				AGENTS_BY_SESSION.get( sessionId )?.abort();
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

async function* createEventStream(
	config: AgentRuntimeConfig,
	sessionId: string,
	controller: AbortController
): AsyncGenerator< AgentRuntimeEvent, void, void > {
	const start = Date.now();
	yield { type: 'run_started', sessionId, model: config.model };

	const family = getAiModelFamily( config.model );
	const resolved = resolveCredentials( family, config.env );
	if ( ! resolved.ok ) {
		yield { type: 'runtime_error', message: resolved.reason };
		yield {
			type: 'turn_completed',
			sessionId,
			subtype: 'error_during_execution',
			isError: true,
			durationMs: Date.now() - start,
			numTurns: 0,
			result: '',
		};
		return;
	}

	try {
		const { agent, lifecycleRef } = await getOrCreateAgent(
			sessionId,
			config,
			family,
			resolved.creds
		);

		const queue: AgentRuntimeEvent[] = [];
		let resolveNext: ( () => void ) | null = null;
		let done = false;
		let numTurns = 0;
		let resultText = '';

		const wake = () => {
			resolveNext?.();
			resolveNext = null;
		};

		lifecycleRef.current = ( phase ) => {
			queue.push( { type: 'compaction', phase } );
			wake();
		};

		const unsubscribe = agent.subscribe( ( event: AgentEvent ) => {
			queue.push( event );

			if ( event.type === 'turn_end' ) {
				numTurns += 1;
				// turn_end's `message` is always a base `Message` from the LLM
				// (user/assistant/toolResult) — branch/compaction summaries
				// don't ride this event. Cast through Message to satisfy
				// SessionManager.appendMessage's narrower signature.
				config.session.appendMessage( event.message as Message );
				for ( const tr of event.toolResults as ToolResultMessage[] ) {
					config.session.appendMessage( tr );
				}
				if ( event.message.role === 'assistant' ) {
					for ( const block of event.message.content ) {
						if ( block.type === 'text' ) {
							resultText = block.text;
						}
					}
				}
			}

			if ( event.type === 'agent_end' ) {
				done = true;
			}

			wake();
		} );

		// Persist the user prompt before the agent starts processing so the
		// transcript on disk matches what the model is about to see.
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
		// Stale closures from previous runs would otherwise keep pushing into a
		// finished queue if a follow-up run reuses the same Agent.
		lifecycleRef.current = null;
		await runPromise.catch( () => undefined );

		const aborted = controller.signal.aborted;
		yield {
			type: 'turn_completed',
			sessionId,
			subtype: aborted ? 'error_during_execution' : 'success',
			isError: aborted,
			durationMs: Date.now() - start,
			numTurns,
			result: resultText,
		};
	} catch ( error ) {
		if ( controller.signal.aborted ) {
			yield {
				type: 'turn_completed',
				sessionId,
				subtype: 'error_during_execution',
				isError: true,
				durationMs: Date.now() - start,
				numTurns: 0,
				result: '',
			};
			return;
		}
		const message = error instanceof Error ? error.message : String( error );
		yield { type: 'runtime_error', message };
		yield {
			type: 'turn_completed',
			sessionId,
			subtype: 'error_during_execution',
			isError: true,
			durationMs: Date.now() - start,
			numTurns: 0,
			result: '',
		};
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
	// conversation continues; on a cold fork hydrate from the SessionManager
	// (which already resolves compaction summaries via buildSessionContext).
	const initialMessages = existing
		? existing.state.messages
		: config.session.buildSessionContext().messages;

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

	// OpenAI Chat Completions reasoning_effort='high' starves visible output
	// on GPT-5.5 (model returns "Done" after a long internal-reasoning turn).
	// Leave reasoning off for OpenAI and let server-side defaults handle it.
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
