import path from 'path';
import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import { AiPluginManager } from 'cli/ai/plugin-manager';
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
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
}

export const AI_MODELS = {
	'claude-sonnet-4-6': 'Sonnet 4.6',
	'claude-opus-4-6': 'Opus 4.6',
} as const;

export type AiModelId = keyof typeof AI_MODELS;

export const DEFAULT_MODEL: AiModelId = 'claude-sonnet-4-6';
const pathApprovalSession = createPathApprovalSession();
const pluginManager = new AiPluginManager();

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
export async function startAiAgent( config: AiAgentConfig ): Promise< Query > {
	const { prompt, env, model = DEFAULT_MODEL, maxTurns = 50, resume, onAskUser } = config;
	const resolvedEnv = env ?? { ...( process.env as Record< string, string > ) };

	const externalPlugins = await pluginManager.resolvePlugins();

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
				...externalPlugins.mcpServers,
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
				...externalPlugins.pluginEntries,
			],
			model,
			resume,
		},
	} );
}

export async function ensurePluginsInstalled(): Promise< void > {
	for ( const manifest of pluginManager.getDefaultPlugins() ) {
		await pluginManager.install( manifest );
	}
}

export async function checkPluginUpdates(): Promise< string | null > {
	for ( const manifest of pluginManager.getDefaultPlugins() ) {
		const result = await pluginManager.checkForUpdates( manifest );
		if ( result.available ) {
			return `data-liberation plugin update available (${ result.currentVersion } → ${ result.latestVersion }). Run 'studio ai plugin update' to update.`;
		}
	}
	return null;
}

export { pluginManager };
