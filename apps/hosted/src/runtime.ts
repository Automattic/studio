import type { JsonEvent } from '@studio/common/ai/json-events';

/**
 * Where the agent actually runs, behind a seam.
 *
 * The run-manager (`agent-runs.ts`) owns all the run bookkeeping (ids, lifecycle
 * events, the interrupt policy) and only delegates the spawn + control surface
 * that genuinely differs per runtime. The hosted backend will plug in a runtime
 * that runs the agent inside a per-session SecEx sandbox; until then the default
 * is {@link stubRuntime}, which has no execution backend yet.
 */

export interface AgentProcessOptions {
	sessionId: string;
	prompt: string;
	displayMessage?: string;
	// The process has started.
	onSpawn: () => void;
	// A JSON transport event the agent emitted.
	onEvent: ( event: JsonEvent ) => void;
	// The process failed to start, or errored before exiting.
	onError: ( message: string ) => void;
	// The process exited. `code` is null when it was terminated by a signal.
	onExit: ( code: number | null ) => void;
}

/**
 * A single in-flight agent run's control surface. The run-manager holds one of
 * these per active run and drives it; the implementation hides whether that's a
 * local child process or a remote sandbox.
 */
export interface AgentProcess {
	// Whether the process can still receive control messages.
	readonly connected: boolean;
	// Cooperatively ask the agent to stop (it aborts the current turn cleanly).
	interrupt(): void;
	// Forcibly terminate the process.
	kill(): void;
	// Deliver answers to a question the agent asked.
	answer( answers: Record< string, string > ): void;
}

export interface AgentRuntime {
	// Start the agent for a session and return its control surface. Lifecycle is
	// reported through the callbacks in `options`.
	start( options: AgentProcessOptions ): AgentProcess;
}
