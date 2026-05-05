import fs from 'fs';
import {
	AI_MODELS,
	DEFAULT_MODEL,
	getAiModelLabel,
	type AiModelId,
} from '@studio/common/ai/models';
import { piRuntime } from 'cli/ai/runtimes/pi';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import type { SessionManager } from '@mariozechner/pi-coding-agent';
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
	// The pi-coding-agent SessionManager backing the conversation. Owns the
	// JSONL file on disk; the runtime appends user/assistant/tool messages to
	// it as the turn progresses. Callers create it via
	// `createStudioSession()` / `openStudioSession()` from `cli/ai/sessions`.
	session: SessionManager;
	env?: Record< string, string >;
	model?: AiModelId;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: AskUserHandler;
}

export function startAiAgent( config: AiAgentConfig ): AgentRuntimeHandle {
	const {
		prompt,
		session,
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
		session,
		activeSite,
		wpcomAccessToken,
		onAskUser,
	} );
}
