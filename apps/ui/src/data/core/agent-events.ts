import type { JsonEvent } from '@studio/common/ai/json-events';

// The subprocess lifecycle events layer on top of the shared JsonEvent
// stream: `run.started` fires when the CLI child actually spawns,
// `run.interrupted` before an explicit kill, and `run.exited` always on
// subprocess termination (the status doubles as a coarse success signal).
export type AgentEvent =
	| JsonEvent
	| { type: 'run.started'; timestamp: string }
	| { type: 'run.exited'; timestamp: string; status: 'success' | 'error'; code: number | null }
	| { type: 'run.interrupted'; timestamp: string };

export interface AgentRunEvent {
	runId: string;
	sessionId: string;
	event: AgentEvent;
}
