import fs from 'fs';
import {
	AI_MODELS,
	DEFAULT_MODEL,
	getAiModelLabel,
	type AiModelId,
} from '@studio/common/ai/models';
import { piRuntime } from 'cli/ai/runtimes/pi';
import { STUDIO_ROOT, type AskUserQuestion } from 'cli/ai/security';
import type { AgentRuntimeHandle } from 'cli/ai/runtimes/types';
import type { SiteInfo } from 'cli/ai/ui';

export type { AskUserQuestion } from 'cli/ai/security';
export { AI_MODELS, DEFAULT_MODEL, getAiModelLabel, type AiModelId };

export interface AiAgentConfig {
	prompt: string;
	env?: Record< string, string >;
	model?: AiModelId;
	maxTurns?: number;
	resume?: string;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
	/**
	 * Absolute path to the JSONL the recorder is writing to. Optional — the
	 * pi runtime uses it to load/save its sidecar transcript so
	 * pi-agent-core memory survives across CLI process forks (the desktop UI
	 * forks per turn). When omitted, the runtime keeps state in memory only
	 * and forgets across forks.
	 */
	sessionFilePath?: string;
}

/**
 * Start the AI agent and return a handle that streams messages until the
 * turn completes. Caller can iterate with `for await` and call `interrupt()`
 * to stop. All models are served by the unified pi runtime; model family
 * (Anthropic vs OpenAI) is resolved internally by `runtimes/pi` from the
 * selected model id.
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

	if ( ! fs.existsSync( STUDIO_ROOT ) ) {
		fs.mkdirSync( STUDIO_ROOT, { recursive: true } );
	}

	return piRuntime.run( {
		prompt,
		env: resolvedEnv,
		model,
		maxTurns,
		resume,
		activeSite,
		wpcomAccessToken,
		onAskUser,
		sessionFilePath,
	} );
}
