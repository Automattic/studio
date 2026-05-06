import type { SessionManager } from '@mariozechner/pi-coding-agent';
import type { AiModelId } from '@studio/common/ai/models';
import type { AskUserQuestion } from 'cli/ai/agent';
import type { AgentRuntimeEvent } from 'cli/ai/runtimes/runtime-events';
import type { SiteInfo } from 'cli/ai/ui';

export interface AgentRuntimeConfig {
	prompt: string;
	env: Record< string, string >;
	model: AiModelId;
	// Pi-managed session. Owns the on-disk JSONL and the in-memory message
	// transcript; runtime hydrates the agent from
	// `session.buildSessionContext()` and appends new messages via
	// `session.appendMessage()` so persistence is implicit.
	session: SessionManager;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
}

export interface AgentRuntimeHandle extends AsyncIterable< AgentRuntimeEvent > {
	interrupt(): Promise< void >;
}

export interface AgentRuntime {
	run( config: AgentRuntimeConfig ): AgentRuntimeHandle;
}
