import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { createStudioTools } from 'cli/ai/tools';

export interface AskUserQuestion {
	question: string;
	options: { label: string; description: string }[];
}

export interface AiAgentConfig {
	prompt: string;
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

/**
 * Start the AI agent and return the Query object.
 * Caller can iterate messages with `for await` and call `interrupt()` to stop.
 */
export function startAiAgent( config: AiAgentConfig ): Query {
	const { prompt, env, model = DEFAULT_MODEL, maxTurns = 50, resume, onAskUser } = config;
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
			cwd: process.cwd(),
			permissionMode: 'bypassPermissions',
			allowDangerouslySkipPermissions: true,
			canUseTool: async ( toolName, input ) => {
				if ( toolName === 'AskUserQuestion' && onAskUser ) {
					const typedInput = input as {
						questions?: AskUserQuestion[];
						answers?: Record< string, string >;
					};
					const questions = typedInput.questions ?? [];
					const answers = await onAskUser( questions );
					return {
						behavior: 'allow' as const,
						updatedInput: { ...input, answers },
					};
				}
				return { behavior: 'allow' as const, updatedInput: input };
			},
			allowedTools: [ 'mcp__studio__*', 'Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep' ],
			model,
			resume,
		},
	} );
}
