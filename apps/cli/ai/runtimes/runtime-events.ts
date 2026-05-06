// Streaming events the runtime yields. Pi's `AgentEvent` covers the run
// lifecycle (agent_start/end, turn_end, message_*, tool_*); compaction is
// the only Studio-specific addition since pi handles compaction internally
// without surfacing user-visible events.

import type { AgentEvent } from '@mariozechner/pi-agent-core';

export type CompactionReason = 'manual' | 'threshold' | 'overflow';

export interface CompactionStartEvent {
	type: 'compaction_start';
	reason: CompactionReason;
}

export interface CompactionEndEvent {
	type: 'compaction_end';
	reason: CompactionReason;
	aborted: boolean;
	willRetry: boolean;
	errorMessage?: string;
}

export type AgentRuntimeEvent = AgentEvent | CompactionStartEvent | CompactionEndEvent;
