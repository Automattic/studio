import fs from 'fs';
import path from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
	ALLOWED_TOOLS,
	STUDIO_ROOT,
	promptForApproval,
	type AskUserQuestion,
} from 'cli/ai/security';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { createRemoteSiteTools, createStudioTools } from 'cli/ai/tools';
import type { AgentRuntime, AgentRuntimeConfig } from '../types';

/**
 * Runtime that talks to Anthropic (direct API or via the WordPress.com proxy)
 * through the Claude Agent SDK. This is the established, supported path.
 */
export const anthropicRuntime: AgentRuntime = {
	run( config: AgentRuntimeConfig ) {
		const {
			prompt,
			env,
			model,
			maxTurns,
			resume,
			autoApprove,
			activeSite,
			wpcomAccessToken,
			onAskUser,
		} = config;

		const isRemoteSite = activeSite?.remote && activeSite?.wpcomSiteId && wpcomAccessToken;

		// Preview-steering tools only belong in the toolset when the Studio
		// desktop UI is on the other end of the IPC channel — otherwise the
		// agent's navigate/reload calls render as noise in the terminal
		// transcript. `process.send` is the same signal `emitEvent` uses to
		// pick between IPC and stdout NDJSON.
		const isForkedByDesktop = typeof process.send === 'function';

		const mcpServers = {
			studio: isRemoteSite
				? createRemoteSiteTools( wpcomAccessToken, activeSite.wpcomSiteId! )
				: createStudioTools( { enablePreviewSteering: isForkedByDesktop } ),
		};

		const allowedTools = [ ...ALLOWED_TOOLS ];

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
				env,
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
				plugins: [
					{
						type: 'local' as const,
						path: path.resolve( import.meta.dirname, '..', '..', 'plugin' ),
					},
				],
				model,
				resume,
			},
		} );
	},
};
