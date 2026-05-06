// Streaming events the runtime yields. Shapes mirror pi-coding-agent's
// `AgentSessionEvent` so an `AgentSession` swap stays drop-in.

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
