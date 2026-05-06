import type { SessionManager, AgentSessionEvent } from '@mariozechner/pi-coding-agent';
import type { AiModelId } from '@studio/common/ai/models';
import type { AskUserQuestion } from 'cli/ai/agent';
import type { SiteInfo } from 'cli/ai/ui';

export interface AgentRuntimeConfig {
	prompt: string;
	env: Record< string, string >;
	model: AiModelId;
	session: SessionManager;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
}

export interface AgentRuntimeHandle extends AsyncIterable< AgentSessionEvent > {
	interrupt(): Promise< void >;
}

export interface AgentRuntime {
	run( config: AgentRuntimeConfig ): AgentRuntimeHandle;
}
