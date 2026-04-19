// Shape of the events streamed over the `ai-agent-event` IPC channel from
// main. Mirrors the subset of `apps/studio/src/modules/ai-agent/json-events.ts`
// the UI consumes — update both together.

export type AgentTurnStatus = 'success' | 'error' | 'paused' | 'max_turns';

export type AgentEvent =
	| { type: 'run.started'; timestamp: string }
	| { type: 'run.exited'; timestamp: string; status: 'success' | 'error'; code: number | null }
	| { type: 'run.interrupted'; timestamp: string }
	| { type: 'message'; timestamp: string; message: unknown }
	| { type: 'progress'; timestamp: string; message: string }
	| { type: 'info'; timestamp: string; message: string }
	| { type: 'error'; timestamp: string; message: string }
	| {
			type: 'question.asked';
			timestamp: string;
			questions: Array< {
				question: string;
				options: Array< { label: string; description: string } >;
			} >;
	  }
	| { type: 'turn.started'; timestamp: string }
	| {
			type: 'turn.completed';
			timestamp: string;
			sessionId: string;
			status: AgentTurnStatus;
			usage?: { numTurns: number; costUsd?: number };
	  };

export interface AgentRunEvent {
	runId: string;
	sessionId: string;
	event: AgentEvent;
}
