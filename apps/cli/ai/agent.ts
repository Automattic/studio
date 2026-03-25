import path from 'path';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import {
	ALLOWED_TOOLS,
	STUDIO_ROOT,
	createPathApprovalSession,
	promptForApproval,
	type AskUserQuestion,
} from 'cli/ai/security';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { createStudioTools } from 'cli/ai/tools';

export type { AskUserQuestion } from 'cli/ai/security';

export interface AiAgentConfig {
	prompt: string;
	env?: Record< string, string >;
	model?: AiModelId;
	maxTurns?: number;
	resume?: string;
	autoApprove?: boolean;
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
}

export const AI_MODELS = {
	'claude-sonnet-4-6': 'Sonnet 4.6',
	'claude-opus-4-6': 'Opus 4.6',
} as const;

export type AiModelId = keyof typeof AI_MODELS;

export const DEFAULT_MODEL: AiModelId = 'claude-sonnet-4-6';
const pathApprovalSession = createPathApprovalSession();

/**
 * Start the AI agent and return the Query object.
 * Caller can iterate messages with `for await` and call `interrupt()` to stop.
 */
export function startAiAgent( config: AiAgentConfig ): Query {
	const {
		prompt,
		env,
		model = DEFAULT_MODEL,
		maxTurns = 50,
		resume,
		autoApprove,
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
				append: buildSystemPrompt(),
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

				return promptForApproval( {
					toolName,
					input,
					metadata,
					onAskUser,
					pathApprovalSession,
				} );
			},
			plugins: [ { type: 'local' as const, path: path.resolve( import.meta.dirname, 'plugin' ) } ],
			model,
			resume,
		},
	} );
}
