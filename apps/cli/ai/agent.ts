import fs from 'fs';
import path from 'path';
import { query, type HookCallback, type Query } from '@anthropic-ai/claude-agent-sdk';
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

	// Configure MCP servers based on site type:
	// Remote sites get WP.com REST API tools + screenshot; local sites get the full Studio toolset.
	const mcpServers = {
		studio: isRemoteSite
			? createRemoteSiteTools( wpcomAccessToken, activeSite.wpcomSiteId! )
			: createStudioTools( { enablePreviewSteering: isForkedByDesktop } ),
	};

	// The remote-session controller sets STUDIO_REMOTE_SESSION=1 when it spawns
	// `studio code --json` so the agent knows it's driving Telegram and should
	// favor screenshot replies.
	const remoteSession = resolvedEnv.STUDIO_REMOTE_SESSION === '1';

	// Build site-aware system prompt
	const systemPromptOptions = isRemoteSite
		? {
				remoteSite: {
					name: activeSite.name,
					url: activeSite.url ?? '',
					id: activeSite.wpcomSiteId!,
				},
				remoteSession,
		  }
		: { previewSteering: isForkedByDesktop, remoteSession };

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
			cwd: STUDIO_SITES_ROOT,
			tools: { type: 'preset', preset: 'claude_code' },
			permissionMode: 'auto',
			...( askUserQuestionHook && {
				hooks: {
					PreToolUse: [ { matcher: 'AskUserQuestion', hooks: [ askUserQuestionHook ] } ],
				},
			} ),
			plugins: [ { type: 'local' as const, path: path.resolve( import.meta.dirname, 'plugin' ) } ],
			model,
			resume,
		},
	} );
}
