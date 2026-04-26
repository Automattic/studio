import type { AiModelId } from '@studio/common/ai/models';
import type { SDKMessage } from 'cli/ai/sdk-message-types';
import type { AskUserQuestion } from 'cli/ai/security';
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
	 * unified pi runtime uses this to locate its sidecar transcript file
	 * (kept next to the JSONL) so pi-agent-core's in-memory `Agent` state
	 * can survive across CLI process forks. When omitted (e.g. tests,
	 * one-shot runs without a recorder), the runtime falls back to
	 * in-memory state only.
	 */
	sessionFilePath?: string;
}

/**
 * The minimal handle `apps/cli/commands/ai/index.ts` consumes from
 * `startAiAgent`. The unified pi runtime builds a structurally compatible
 * object — the SDKMessage shapes it yields are synthesized to match what the
 * recorder JSONL contract and the desktop UI already expect.
 */
export interface AgentRuntimeHandle extends AsyncIterable< SDKMessage > {
	interrupt(): Promise< void >;
}

export interface AgentRuntime {
	run( config: AgentRuntimeConfig ): AgentRuntimeHandle;
}
