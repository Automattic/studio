import type { JsonEvent } from './json-events';
import type { PermissionRequestData } from './tool-permissions';

export type AgentEvent =
	| JsonEvent
	| { type: 'run.started'; timestamp: string }
	| { type: 'run.interrupting'; timestamp: string }
	| { type: 'run.exited'; timestamp: string; status: 'success' | 'error'; code: number | null }
	| { type: 'run.interrupted'; timestamp: string };

export interface AgentRunEvent {
	runId: string;
	sessionId: string;
	event: AgentEvent;
}

export interface PendingAgentQuestion {
	question: string;
	options: Array< { label: string; description: string } >;
}

export interface ActiveAgentRun {
	runId: string;
	sessionId: string;
	startedAt: number;
	phase: 'running' | 'interrupting';
	// What the run is currently blocked on — unanswered questions and gated
	// tool calls. Carried in the active-run snapshot so a reloaded renderer can
	// restore the pending interaction: the agent process is still waiting on
	// the answer.
	pendingQuestions?: PendingAgentQuestion[];
	pendingPermissions?: PermissionRequestData[];
}
