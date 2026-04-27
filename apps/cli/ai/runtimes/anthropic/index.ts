import path from 'path';
import { query, type HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { createRemoteSiteTools, createStudioTools } from 'cli/ai/tools';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { AgentRuntime, AgentRuntimeConfig } from '../types';
import type { AskUserQuestion } from 'cli/ai/agent';

/**
 * Runtime that talks to Anthropic (direct API or via the WordPress.com proxy)
 * through the Claude Agent SDK. Permission classification is delegated to the
 * SDK's `auto` mode — see #3242 on trunk for the rationale (drops the
 * ad-hoc, easily-bypassed gating that lived in `cli/ai/security` and lets the
 * SDK make the call instead).
 */
export const anthropicRuntime: AgentRuntime = {
	run( config: AgentRuntimeConfig ) {
		const { prompt, env, model, maxTurns, resume, activeSite, wpcomAccessToken, onAskUser } =
			config;

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

		const systemPromptOptions = isRemoteSite
			? {
					remoteSite: {
						name: activeSite.name,
						url: activeSite.url ?? '',
						id: activeSite.wpcomSiteId!,
					},
			  }
			: { previewSteering: isForkedByDesktop };

		// Intercept the built-in AskUserQuestion tool so the agent's questions
		// render in our chat UI (via onAskUser) instead of the SDK's default
		// prompt. PreToolUse with `matcher: 'AskUserQuestion'` lets us inject
		// answers via `updatedInput` and approve the call, while leaving every
		// other tool to the 'auto' permission classifier.
		const askUserQuestionHook: HookCallback | undefined = onAskUser
			? async ( input ) => {
					if ( input.hook_event_name !== 'PreToolUse' ) {
						return {};
					}
					const toolInput = input.tool_input as {
						questions?: AskUserQuestion[];
						answers?: Record< string, string >;
					};
					const questions = ( toolInput.questions ?? [] ).map( ( q ) => ( {
						...q,
						allowFreeForm: true,
					} ) );
					const answers = await onAskUser( questions );
					return {
						hookSpecificOutput: {
							hookEventName: 'PreToolUse' as const,
							permissionDecision: 'allow' as const,
							updatedInput: { ...toolInput, answers },
						},
					};
			  }
			: undefined;

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
				cwd: STUDIO_SITES_ROOT,
				tools: { type: 'preset', preset: 'claude_code' },
				permissionMode: 'auto',
				...( askUserQuestionHook && {
					hooks: {
						PreToolUse: [ { matcher: 'AskUserQuestion', hooks: [ askUserQuestionHook ] } ],
					},
				} ),
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
