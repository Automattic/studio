import fs from 'fs';
import path from 'path';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { AI_MODELS, DEFAULT_MODEL, type AiModelId } from '@studio/common/ai/models';
import {
	ALLOWED_TOOLS,
	STUDIO_ROOT,
	promptForApproval,
	type AskUserQuestion,
} from 'cli/ai/security';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { createRemoteSiteTools, createStudioTools } from 'cli/ai/tools';
import type { SiteInfo } from 'cli/ai/ui';

export type { AskUserQuestion } from 'cli/ai/security';
export { AI_MODELS, DEFAULT_MODEL, type AiModelId };

export interface AiAgentConfig {
	prompt: string;
	env?: Record< string, string >;
	model?: AiModelId;
	maxTurns?: number;
	resume?: string;
	autoApprove?: boolean;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
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
		autoApprove,
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

	const allowedTools = [ ...ALLOWED_TOOLS ];

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

	if ( ! fs.existsSync( STUDIO_ROOT ) ) {
		fs.mkdirSync( STUDIO_ROOT, { recursive: true } );
	}

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
			cwd: STUDIO_ROOT,
			tools: { type: 'preset', preset: 'claude_code' },
			allowedTools,
			permissionMode: 'default',
			canUseTool: async ( toolName, input, metadata ) => {
				if ( autoApprove ) {
					return {
						behavior: 'allow' as const,
						updatedInput: input as Record< string, unknown >,
					};
				}

				if ( toolName === 'AskUserQuestion' && onAskUser ) {
					const typedInput = input as {
						questions?: AskUserQuestion[];
						answers?: Record< string, string >;
					};
					const questions = ( typedInput.questions ?? [] ).map( ( q ) => ( {
						...q,
						allowFreeForm: true,
					} ) );
					const answers = await onAskUser( questions );
					return {
						behavior: 'allow' as const,
						updatedInput: { ...input, answers },
					};
				}

				return promptForApproval( { toolName, input, metadata, onAskUser } );
			},
			plugins: [ { type: 'local' as const, path: path.resolve( import.meta.dirname, 'plugin' ) } ],
			model,
			resume,
		},
	} );
}
