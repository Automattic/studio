import fs from 'fs';
import {
	AI_MODELS,
	DEFAULT_MODEL,
	getAiModelLabel,
	type AiModelId,
} from '@studio/common/ai/models';
import { piRuntime } from 'cli/ai/runtimes/pi';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { AgentRuntimeHandle } from 'cli/ai/runtimes/types';
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
	resume?: string;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: AskUserHandler;
	// JSONL path the recorder writes to; the runtime stashes a sidecar
	// transcript next to it so pi-agent-core state survives CLI process forks.
	sessionFilePath?: string;
}

export function startAiAgent( config: AiAgentConfig ): AgentRuntimeHandle {
	const {
		prompt,
		env,
		model = DEFAULT_MODEL,
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

	return piRuntime.run( {
		prompt,
		env: resolvedEnv,
		model,
		resume,
		activeSite,
		wpcomAccessToken,
		onAskUser,
		sessionFilePath,
	} );
}
