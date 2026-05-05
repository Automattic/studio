// Streaming events the agent runtime yields to consumers (CLI ui, JSON
// adapter, eval-runner, replay). Replaces the legacy synthetic-`SDKMessage`
// shape — events are pi-native plus a small Studio overlay (compaction
// lifecycle, runtime errors, turn boundaries with metrics).

import type { AgentEvent } from '@mariozechner/pi-agent-core';

export type CompactionPhase = 'start' | 'end' | 'skipped' | 'failed';

export interface CompactionEvent {
	type: 'compaction';
	phase: CompactionPhase;
}

export interface RuntimeErrorEvent {
	type: 'runtime_error';
	message: string;
}

// `turn_completed` summarizes a full agent run from the runtime's
// perspective. Consumers use it to print "Done · Thought for Xs" lines and
// to surface usage caps, permission denials, etc.
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

// Emitted once at the start of every run so consumers can stamp the
// session id and active model on their state.
export interface RunStartedEvent {
	type: 'run_started';
	sessionId: string;
	model: string;
}

export type AgentRuntimeEvent =
	| AgentEvent
	| RunStartedEvent
	| CompactionEvent
	| RuntimeErrorEvent
	| TurnCompletedEvent;
