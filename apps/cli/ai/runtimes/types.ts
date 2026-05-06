import type { AiModelId } from '@studio/common/ai/models';
import type { AskUserQuestion } from 'cli/ai/agent';
import type { AgentRuntimeEvent } from 'cli/ai/runtimes/runtime-events';
import type { SiteInfo } from 'cli/ai/ui';

export interface AgentRuntimeConfig {
	prompt: string;
	env: Record< string, string >;
	model: AiModelId;
	// Stable session id used for the runtime event stream and the
	// `X-WPCOM-Session-ID` header. The orchestrator owns this id and writes
	// it to the on-disk JSONL via `appendAiSessionEvent` / `createAiSession`.
	sessionId: string;
	// Path to the legacy `AiSessionEvent[]` JSONL the runtime hydrates from
	// (on cold-start / desktop fork) and appends new pi turns to.
	sessionFilePath: string;
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
