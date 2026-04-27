import fs from 'fs';
import {
	AI_MODELS,
	DEFAULT_MODEL,
	getAiModelFamily,
	getAiModelLabel,
	type AiModelId,
} from '@studio/common/ai/models';
import { anthropicRuntime } from 'cli/ai/runtimes/anthropic';
import { isOpenAIRuntimeSession, openaiRuntime } from 'cli/ai/runtimes/openai';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { AgentRuntime, AgentRuntimeHandle } from 'cli/ai/runtimes/types';
import type { SiteInfo } from 'cli/ai/ui';

export { AI_MODELS, DEFAULT_MODEL, getAiModelLabel, type AiModelId };

export interface AskUserQuestion {
	question: string;
	options: { label: string; description: string }[];
	allowFreeForm?: boolean;
}

export type AskUserHandler = (
	questions: AskUserQuestion[]
) => Promise< Record< string, string > >;

export interface AiAgentConfig {
	prompt: string;
	env?: Record< string, string >;
	model?: AiModelId;
	maxTurns?: number;
	resume?: string;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: AskUserHandler;
	/**
	 * Absolute path to the JSONL the recorder is writing to. Optional —
	 * the OpenAI runtime uses it to load/save its sidecar transcript so
	 * pi-agent-core memory survives across CLI process forks (the desktop
	 * UI forks per turn). When omitted, the OpenAI runtime keeps state in
	 * memory only and forgets across forks.
	 */
	sessionFilePath?: string;
}

// The Claude Agent SDK rejects internal pending promises (e.g. control
// responses) when an agent turn is interrupted via ESC. These rejections
// are unhandled because they originate inside the SDK cleanup path rather
// than propagating through the async iterator. Without this handler,
// Node.js terminates the process on unhandled rejections.
const SDK_INTERRUPT_CLEANUP_ERRORS = [
	'Query closed',
	'ProcessTransport is not ready for writing',
];
process.on( 'unhandledRejection', ( reason ) => {
	if (
		reason instanceof Error &&
		SDK_INTERRUPT_CLEANUP_ERRORS.some( ( msg ) => reason.message.includes( msg ) )
	) {
		return;
	}
	throw reason;
} );

/**
 * Pick the runtime based on the selected model's family. GPT-* models route to
 * the OpenAI runtime; everything else defaults to the Claude Agent SDK path.
 *
 * Matches the user-facing mental model: `/model` is the control, and whichever
 * model you pick dictates which backend handles the turn — independent of
 * which provider supplied the credentials.
 */
function pickRuntime( model: AiModelId ): AgentRuntime {
	return getAiModelFamily( model ) === 'openai' ? openaiRuntime : anthropicRuntime;
}

/**
 * Start the AI agent and return a handle that streams messages until the
 * turn completes. Caller can iterate with `for await` and call `interrupt()`
 * to stop. The concrete runtime (Anthropic vs OpenAI) is chosen based on the
 * resolved environment.
 */
export function startAiAgent( config: AiAgentConfig ): AgentRuntimeHandle {
	const {
		prompt,
		env,
		model = DEFAULT_MODEL,
		maxTurns = 75,
		resume,
		activeSite,
		wpcomAccessToken,
		onAskUser,
		sessionFilePath,
	} = config;
	const resolvedEnv = env ?? { ...( process.env as Record< string, string > ) };

	if ( ! fs.existsSync( STUDIO_SITES_ROOT ) ) {
		fs.mkdirSync( STUDIO_SITES_ROOT, { recursive: true } );
	}

	const runtime = pickRuntime( model );
	// Cross-family resume guard. If the caller passes a `resume` id that was
	// issued by the OpenAI runtime but we're now routing to the Anthropic
	// runtime (e.g. user picked a different family in the model dropdown
	// mid-session), the Claude Agent SDK doesn't recognize it and errors with
	// "No conversation found". Drop the resume hint instead — the new runtime
	// starts a fresh agent thread, the session record on disk continues
	// accumulating turns. The OpenAI direction handles unknown resume ids
	// silently (see runtimes/openai/index.ts), so we only need to gate the
	// Anthropic side. In-memory tracking; survives a single process lifetime
	// only (see comment on isOpenAIRuntimeSession).
	const safeResume =
		resume && getAiModelFamily( model ) === 'anthropic' && isOpenAIRuntimeSession( resume )
			? undefined
			: resume;

	return runtime.run( {
		prompt,
		env: resolvedEnv,
		model,
		maxTurns,
		resume: safeResume,
		activeSite,
		wpcomAccessToken,
		onAskUser,
		sessionFilePath,
	} );
}
