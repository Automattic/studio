import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AiModelId } from '@studio/common/ai/models';
import type { AskUserQuestion } from 'cli/ai/agent';
import type { SiteInfo } from 'cli/ai/ui';

export interface AgentRuntimeConfig {
	prompt: string;
	env: Record< string, string >;
	model: AiModelId;
	maxTurns: number;
	resume?: string;
	autoApprove?: boolean;
	activeSite?: SiteInfo | null;
	wpcomAccessToken?: string;
	onAskUser?: ( questions: AskUserQuestion[] ) => Promise< Record< string, string > >;
	/**
	 * Absolute path to the session JSONL the recorder is writing to. The
	 * OpenAI runtime uses this to locate its sidecar transcript file (kept
	 * next to the JSONL) so pi-agent-core's in-memory `Agent` state can
	 * survive across CLI process forks. When omitted (e.g. tests, one-shot
	 * runs without a recorder), the OpenAI runtime falls back to in-memory
	 * state only.
	 */
	sessionFilePath?: string;
}

/**
 * The minimal handle `apps/cli/commands/ai/index.ts` consumes from `startAiAgent`.
 * The Anthropic runtime returns the Claude Agent SDK's `Query` directly (which
 * already satisfies this shape). The OpenAI runtime builds a structurally
 * compatible object so the UI and session recorder keep working unchanged.
 */
export interface AgentRuntimeHandle extends AsyncIterable< SDKMessage > {
	interrupt(): Promise< void >;
}

export interface AgentRuntime {
	run( config: AgentRuntimeConfig ): AgentRuntimeHandle;
}
