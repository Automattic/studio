import { query, type Query } from '@anthropic-ai/claude-agent-sdk';
import {
	ACCESS_DENIED_MESSAGE,
	ALLOWED_TOOLS,
	STUDIO_ROOT,
	askForPathGatedToolApproval,
	createPathApprovalSession,
	getPathGatedPermissionRequest,
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
					const questions = typedInput.questions ?? [];
					const answers = await onAskUser( questions );
					return {
						behavior: 'allow' as const,
						updatedInput: { ...input, answers },
					};
				}

				const permissionRequest = getPathGatedPermissionRequest( {
					toolName,
					input,
					blockedPath: metadata.blockedPath,
					suggestions: metadata.suggestions,
				} );

				if ( permissionRequest ) {
					if ( ! pathApprovalSession.hasApprovedPath( toolName, permissionRequest.approvalPath ) ) {
						const approvalDecision = await askForPathGatedToolApproval( {
							toolName,
							outsidePath: permissionRequest.approvalPath,
							onAskUser,
						} );

						if ( approvalDecision === 'deny' ) {
							return {
								behavior: 'deny' as const,
								message: ACCESS_DENIED_MESSAGE,
							};
						}

						if ( approvalDecision === 'allow_session' ) {
							pathApprovalSession.rememberApprovedPath( toolName, permissionRequest.approvalPath );
						}
					}

					return {
						behavior: 'allow' as const,
						updatedInput: input,
						...( permissionRequest.updatedPermissions && {
							updatedPermissions: permissionRequest.updatedPermissions,
						} ),
					};
				}

				return { behavior: 'allow' as const, updatedInput: input };
			},
			model,
			resume,
		},
	} );
}
