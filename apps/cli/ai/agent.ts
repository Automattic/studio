import path from 'path';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { getClaudeCodePlugins, isClaudeCodePluginProvider } from 'cli/ai/claude-code-plugins';
import {
	ALLOWED_TOOLS,
	STUDIO_ROOT,
	createPathApprovalSession,
	promptForApproval,
	type AskUserQuestion,
} from 'cli/ai/security';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { createStudioTools } from 'cli/ai/tools';
import type { AiProviderId } from 'cli/ai/providers';

export type { AskUserQuestion } from 'cli/ai/security';

export interface AiAgentConfig {
	prompt: string;
	provider?: AiProviderId;
	siteContext?: string;
	env?: Record< string, string >;
	model?: AiModelId;
	maxTurns?: number;
	resume?: string;
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
}

export const AI_MODELS = {
	'claude-sonnet-4-6': 'Sonnet 4.6',
	'claude-opus-4-6': 'Opus 4.6',
} as const;

export type AiModelId = keyof typeof AI_MODELS;

export const DEFAULT_MODEL: AiModelId = 'claude-sonnet-4-6';
const pathApprovalSession = createPathApprovalSession();

// The Claude Agent SDK rejects internal pending promises (e.g. control
// responses) when an agent turn is interrupted via ESC. These rejections
// are unhandled because they originate inside the SDK cleanup path rather
// than propagating through the async iterator. Without this handler,
// Node.js terminates the process on unhandled rejections.
process.on( 'unhandledRejection', ( reason ) => {
	if ( reason instanceof Error && reason.message.includes( 'Query closed' ) ) {
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
		provider,
		siteContext,
		env,
		model = DEFAULT_MODEL,
		maxTurns = 50,
		resume,
		onAskUser,
	} = config;
	const resolvedEnv = env ?? { ...( process.env as Record< string, string > ) };

	return query( {
		prompt,
		options: {
			env: resolvedEnv,
			systemPrompt: {
				type: 'preset',
				preset: 'claude_code',
				append: buildSystemPrompt( siteContext ),
			},
			mcpServers: {
				studio: createStudioTools(),
			},
			maxTurns,
			cwd: STUDIO_ROOT,
			tools: { type: 'preset', preset: 'claude_code' },
			allowedTools: [ ...ALLOWED_TOOLS ],
			permissionMode: 'default',
			canUseTool: async ( toolName, input, metadata ) => {
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

				return promptForApproval( {
					toolName,
					input,
					metadata,
					onAskUser,
					pathApprovalSession,
				} );
			},
			plugins: [
				{ type: 'local' as const, path: path.resolve( import.meta.dirname, 'plugin' ) },
				...( isClaudeCodePluginProvider( provider ) ? getClaudeCodePlugins() : [] ),
			],
			model,
			resume,
		},
	} );
}
