import type { AiModelId } from '@studio/common/ai/models';
import type { AskUserQuestion } from 'cli/ai/agent';
import type { SDKMessage } from 'cli/ai/runtimes/messages';
import type { SiteInfo } from 'cli/ai/ui';

export interface AgentRuntimeConfig {
	prompt: string;
	env: Record< string, string >;
	model: AiModelId;
	resume?: string;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
	// JSONL path the recorder writes to; the runtime sidecars its in-memory
	// `Agent` state next to it so memory survives CLI process forks.
	sessionFilePath?: string;
}

export interface AgentRuntimeHandle extends AsyncIterable< SDKMessage > {
	interrupt(): Promise< void >;
}

export interface AgentRuntime {
	run( config: AgentRuntimeConfig ): AgentRuntimeHandle;
}
