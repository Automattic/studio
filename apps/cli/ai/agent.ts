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
	// Stable session identifier — survives across CLI process forks because
	// it's the id stored inside the legacy session JSONL.
	sessionId: string;
	// Path to the legacy `AiSessionEvent[]` JSONL on disk. The runtime
	// hydrates pi `AgentMessage[]` from it and appends new turns back as
	// `sdk.message` events.
	sessionFilePath: string;
	env?: Record< string, string >;
	model?: AiModelId;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: AskUserHandler;
}

export function startAiAgent( config: AiAgentConfig ): AgentRuntimeHandle {
	const {
		prompt,
		sessionId,
		sessionFilePath,
		env,
		model = DEFAULT_MODEL,
		activeSite,
		wpcomAccessToken,
		onAskUser,
	} = config;
	const resolvedEnv = env ?? { ...( process.env as Record< string, string > ) };

	if ( ! fs.existsSync( STUDIO_SITES_ROOT ) ) {
		fs.mkdirSync( STUDIO_SITES_ROOT, { recursive: true } );
	}

	return piRuntime.run( {
		prompt,
		env: resolvedEnv,
		model,
		sessionId,
		sessionFilePath,
		activeSite,
		wpcomAccessToken,
		onAskUser,
	} );
}
