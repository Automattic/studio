// Streaming events the agent runtime yields to consumers (CLI ui, JSON
// adapter, eval-runner, replay). Pi events flow through verbatim. The two
// Studio events we add — `compaction_start` / `compaction_end` and
// `turn_completed` — match pi-coding-agent's `AgentSessionEvent` shape so
// the eventual swap to `AgentSession` is a drop-in.

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

// `turn_completed` summarizes a full agent run from the runtime's
// perspective. Consumers use it to print "Done · Thought for Xs" lines and
// to surface errors / permission denials. `result` carries the final text
// or, on failure, the runtime error message.
export interface TurnCompletedEvent {
	type: 'turn_completed';
	sessionId: string;
	subtype: 'success' | 'error_during_execution';
	isError: boolean;
	durationMs: number;
	numTurns: number;
	result: string;
	errors?: string[];
	permissionDenials?: Array< { tool_name: string } >;
}

export type AgentRuntimeEvent =
	| AgentEvent
	| CompactionStartEvent
	| CompactionEndEvent
	| TurnCompletedEvent;
