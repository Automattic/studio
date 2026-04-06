import path from 'path';
import { query, type Query, type McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import {
	ALLOWED_TOOLS,
	ALLOWED_TOOLS_REMOTE,
	STUDIO_ROOT,
	createPathApprovalSession,
	promptForApproval,
	type AskUserQuestion,
} from 'cli/ai/security';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { createRemoteCompatibleTools, createStudioTools } from 'cli/ai/tools';
import type { SiteInfo } from 'cli/ai/ui';

export type { AskUserQuestion } from 'cli/ai/security';

export interface AiAgentConfig {
	prompt: string;
	env?: Record< string, string >;
	model?: AiModelId;
	maxTurns?: number;
	resume?: string;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
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

const WPCOM_MCP_URL = 'https://public-api.wordpress.com/wpcom/v2/mcp/v1';

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
		activeSite,
		wpcomAccessToken,
		onAskUser,
	} = config;
	const resolvedEnv = env ?? { ...( process.env as Record< string, string > ) };

	const isRemoteSite = activeSite?.remote && activeSite?.wpcomSiteId && wpcomAccessToken;

	// Configure MCP servers based on site type
	const mcpServers: Record< string, McpServerConfig > = {};
	if ( isRemoteSite ) {
		mcpServers.wpcom = {
			type: 'http' as const,
			url: WPCOM_MCP_URL,
			headers: {
				Authorization: `Bearer ${ wpcomAccessToken }`,
			},
		};
		// Expose URL-based tools (screenshot) that work with any site
		mcpServers.studio = createRemoteCompatibleTools();
	} else {
		mcpServers.studio = createStudioTools();
	}

	const allowedTools = isRemoteSite ? [ ...ALLOWED_TOOLS_REMOTE ] : [ ...ALLOWED_TOOLS ];

	// Build site-aware system prompt
	const systemPromptOptions = isRemoteSite
		? {
				remoteSite: {
					name: activeSite.name,
					url: activeSite.url ?? '',
					id: activeSite.wpcomSiteId!,
				},
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
			cwd: STUDIO_ROOT,
			tools: { type: 'preset', preset: 'claude_code' },
			allowedTools,
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
			plugins: [ { type: 'local' as const, path: path.resolve( import.meta.dirname, 'plugin' ) } ],
			model,
			resume,
		},
	} );
}
