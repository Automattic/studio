import { query, type McpServerConfig, type Query } from '@anthropic-ai/claude-agent-sdk';
import { getFigmaAccessToken } from 'cli/ai/figma-oauth';
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
 * Build the Figma MCP server config with auth headers if a token is available.
 */
async function buildFigmaMcpConfig(): Promise< McpServerConfig > {
	const token = await getFigmaAccessToken();
	const config: McpServerConfig = {
		type: 'http',
		url: 'https://mcp.figma.com/mcp',
	};
	if ( token ) {
		config.headers = { Authorization: `Bearer ${ token }` };
	}
	return config;
}

/**
 * Start the AI agent and return the Query object.
 * Caller can iterate messages with `for await` and call `interrupt()` to stop.
 */
export async function startAiAgent( config: AiAgentConfig ): Promise< Query > {
	const { prompt, env, model = DEFAULT_MODEL, maxTurns = 50, resume, onAskUser } = config;
	const resolvedEnv = env ?? { ...( process.env as Record< string, string > ) };

	const figmaConfig = await buildFigmaMcpConfig();

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
				figma: figmaConfig,
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
			allowedTools: [
				'mcp__studio__*',
				'mcp__figma__*',
				'Read',
				'Write',
				'Edit',
				'Bash',
				'Glob',
				'Grep',
			],
			// get_metadata responses are too large for the JSON transport and
			// crash the session. Figma's own docs recommend get_design_context
			// instead, which returns the same structural info in compact form.
			disallowedTools: [ 'mcp__figma__get_metadata' ],
			model,
			resume,
		},
	} );
}
