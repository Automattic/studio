import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { createStudioTools } from 'cli/ai/tools';

export interface AskUserQuestion {
	question: string;
	options: { label: string; description: string }[];
}

export interface AiAgentConfig {
	prompt: string;
	apiKey: string;
	maxTurns?: number;
	resume?: string;
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
}

export interface AiAgentResult {
	sessionId: string;
	success: boolean;
}

function buildEnv( apiKey: string ): Record< string, string > {
	const env: Record< string, string > = {};
	for ( const [ key, value ] of Object.entries( process.env ) ) {
		if ( value !== undefined ) {
			env[ key ] = value;
		}
	}
	env.ANTHROPIC_API_KEY = apiKey;
	return env;
}

/**
 * Start the AI agent and return the Query object.
 * Caller can iterate messages with `for await` and call `interrupt()` to stop.
 */
export function startAiAgent( config: AiAgentConfig ): Query {
	const { prompt, apiKey, maxTurns = 30, resume, onAskUser } = config;

	return query( {
		prompt,
		options: {
			env: buildEnv( apiKey ),
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
			model: 'claude-sonnet-4-6',
			resume,
		},
	} );
}
