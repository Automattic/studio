import type { JsonEvent } from '@studio/common/ai/json-events';

export interface AgentRunEvent {
	runId: string;
	sessionId: string;
	event:
		| JsonEvent
		| { type: 'run.started'; timestamp: string }
		| { type: 'run.exited'; timestamp: string; status: 'success' | 'error'; code: number | null }
		| { type: 'run.interrupted'; timestamp: string };
}
