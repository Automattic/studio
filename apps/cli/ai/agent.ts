import fs from 'fs';
import path from 'path';
import {
	query,
	type HookCallback,
	type McpServerConfig,
	type Query,
} from '@anthropic-ai/claude-agent-sdk';
import { AI_MODELS, DEFAULT_MODEL, type AiModelId } from '@studio/common/ai/models';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { createRemoteSiteTools, createStudioTools } from 'cli/ai/tools';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { SiteInfo } from 'cli/ai/ui';

export { AI_MODELS, DEFAULT_MODEL, type AiModelId };

export interface AskUserQuestion {
	question: string;
	options: { label: string; description: string }[];
	allowFreeForm?: boolean;
}

export type AskUserHandler = (
	questions: AskUserQuestion[]
) => Promise< Record< string, string > >;

export interface AiAgentConfig {
	prompt: string;
	env?: Record< string, string >;
	model?: AiModelId;
	maxTurns?: number;
	resume?: string;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: AskUserHandler;
}

// The Claude Agent SDK rejects internal pending promises (e.g. control
// responses) when an agent turn is interrupted via ESC. These rejections
// are unhandled because they originate inside the SDK cleanup path rather
// than propagating through the async iterator. Without this handler,
// Node.js terminates the process on unhandled rejections.
const SDK_INTERRUPT_CLEANUP_ERRORS = [
	'Query closed',
	'ProcessTransport is not ready for writing',
];
process.on( 'unhandledRejection', ( reason ) => {
	if (
		reason instanceof Error &&
		SDK_INTERRUPT_CLEANUP_ERRORS.some( ( msg ) => reason.message.includes( msg ) )
	) {
		return;
	}
	throw reason;
} );

/**
 * Start the AI agent and return the Query object.
 * Caller can iterate messages with `for await` and call `interrupt()` to stop.
 */
export function startAiAgent( config: AiAgentConfig ): Query {
	const {
		prompt,
		env,
		model = DEFAULT_MODEL,
		maxTurns = 75,
		resume,
		activeSite,
		wpcomAccessToken,
		onAskUser,
	} = config;
	const resolvedEnv = env ?? { ...( process.env as Record< string, string > ) };

	const isRemoteSite = activeSite?.remote && activeSite?.wpcomSiteId && wpcomAccessToken;

	// Preview-steering tools only belong in the toolset when the Studio
	// desktop UI is on the other end of the IPC channel — otherwise the
	// agent's navigate/reload calls render as noise in the terminal
	// transcript. `process.send` is the same signal `emitEvent` uses to
	// pick between IPC and stdout NDJSON.
	const isForkedByDesktop = typeof process.send === 'function';

	// The Data Liberation Agent (DLA) ships as an optional sibling tree at
	// `apps/cli/ai/dla/`, vendored by `scripts/download-data-liberation-agent.ts`
	// at install time. Contributors without a `GH_PAT` (or anyone who skipped
	// the download) won't have it on disk; gating registration on `existsSync`
	// keeps the agent runnable without DLA and only adds the `/migrate`
	// surface when it's actually available.
	const dlaPath = path.resolve( import.meta.dirname, 'dla' );
	const dlaAvailable = fs.existsSync( dlaPath );

	// Configure MCP servers based on site type:
	// Remote sites get WP.com REST API tools + screenshot; local sites get the full Studio toolset.
	const mcpServers: Record< string, McpServerConfig > = {
		studio: isRemoteSite
			? createRemoteSiteTools( wpcomAccessToken, activeSite.wpcomSiteId! )
			: createStudioTools( { enablePreviewSteering: isForkedByDesktop } ),
	};

	if ( dlaAvailable ) {
		// Spawn DLA's MCP server as a stdio child process. We use
		// `process.execPath` (rather than the literal string `'node'`) so the
		// Electron-bundled binary path picks up the same Node runtime the host
		// is already using — same precedent as `apps/cli/ai/browser-utils.ts`
		// and `apps/cli/lib/daemon-client.ts`.
		//
		// We pass an absolute path to `mcp-server.js` rather than relying on a
		// `cwd` field, because the Anthropic Agent SDK's `McpStdioServerConfig`
		// type (see `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`
		// around line 395) only accepts `{ type, command, args, env }` — there
		// is no `cwd` field, and inspection of the SDK's spawn pipeline
		// (`spawnLocalProcess` in `sdk.mjs`) shows `cwd` is only honored for
		// the host Claude Code process, not forwarded to MCP children. DLA's
		// internal scripts must therefore resolve their own peers via
		// `import.meta.url` (which is always absolute) rather than relative
		// to a working directory.
		//
		// `STUDIO_WPCOM_TOKEN` is forwarded explicitly so DLA tools targeting
		// a remote WordPress.com site work even when the active Studio site
		// is local. `LIBERATION_TOKEN` and `SHOPIFY_ADMIN_TOKEN` are forwarded
		// transitively via `...resolvedEnv` (they originate in `process.env`).
		//
		// If the spawned child fails to start at runtime (missing file,
		// malformed binary), the SDK reports the MCP server status as
		// `'failed'` and the rest of the agent stays up — `/migrate` would
		// surface that as a tool-not-available error rather than crashing
		// the session. We rely on the SDK's own error reporting here.
		mcpServers[ 'data-liberation' ] = {
			type: 'stdio',
			command: process.execPath,
			args: [ path.resolve( dlaPath, 'src/mcp-server.js' ) ],
			env: {
				...resolvedEnv,
				STUDIO_WPCOM_TOKEN: wpcomAccessToken ?? '',
			},
		};
	}

	// Build site-aware system prompt
	const systemPromptOptions = isRemoteSite
		? {
				remoteSite: {
					name: activeSite.name,
					url: activeSite.url ?? '',
					id: activeSite.wpcomSiteId!,
				},
		  }
		: { previewSteering: isForkedByDesktop };

	if ( ! fs.existsSync( STUDIO_SITES_ROOT ) ) {
		fs.mkdirSync( STUDIO_SITES_ROOT, { recursive: true } );
	}

	// Intercept the built-in AskUserQuestion tool so the agent's questions
	// render in our chat UI (via onAskUser) instead of the SDK's default
	// prompt. PreToolUse with `matcher: 'AskUserQuestion'` lets us inject
	// answers via `updatedInput` and approve the call, while leaving every
	// other tool to the 'auto' permission classifier.
	const askUserQuestionHook: HookCallback | undefined = onAskUser
		? async ( input ) => {
				if ( input.hook_event_name !== 'PreToolUse' ) {
					return {};
				}
				const toolInput = input.tool_input as {
					questions?: AskUserQuestion[];
					answers?: Record< string, string >;
				};
				const questions = ( toolInput.questions ?? [] ).map( ( q ) => ( {
					...q,
					allowFreeForm: true,
				} ) );
				const answers = await onAskUser( questions );
				return {
					hookSpecificOutput: {
						hookEventName: 'PreToolUse' as const,
						permissionDecision: 'allow' as const,
						updatedInput: { ...toolInput, answers },
					},
				};
		  }
		: undefined;

	return query( {
		prompt,
		options: {
			env: resolvedEnv,
			systemPrompt: {
				type: 'preset',
				preset: 'claude_code',
				append: buildSystemPrompt( systemPromptOptions ),
			},
			mcpServers,
			maxTurns,
			cwd: STUDIO_SITES_ROOT,
			tools: { type: 'preset', preset: 'claude_code' },
			permissionMode: 'auto',
			...( askUserQuestionHook && {
				hooks: {
					PreToolUse: [ { matcher: 'AskUserQuestion', hooks: [ askUserQuestionHook ] } ],
				},
			} ),
			plugins: [
				{ type: 'local' as const, path: path.resolve( import.meta.dirname, 'plugin' ) },
				...( dlaAvailable ? [ { type: 'local' as const, path: dlaPath } ] : [] ),
			],
			model,
			resume,
		},
	} );
}
