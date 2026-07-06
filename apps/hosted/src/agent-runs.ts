import crypto from 'node:crypto';
import { stubRuntime } from './stub-runtime';
import type { AgentProcess, AgentRuntime } from './runtime';
import type { ActiveAgentRun, AgentEvent, AgentRunEvent } from '@studio/common/ai/agent-events';
import type { PermissionDecision } from '@studio/common/ai/tool-permissions';

/**
 * Headless analog of the desktop `run-manager` (apps/studio/src/modules/
 * ai-agent/run-manager.ts). It relays the agent's `JsonEvent`s as
 * `AgentRunEvent`s and synthesizes the same lifecycle events (`run.started`,
 * `run.exited`, ...). The sink is a broadcaster (SSE) injected via
 * `setBroadcast` instead of `webContents.send`.
 *
 * Where the agent actually runs is behind the {@link AgentRuntime} seam. The
 * default is {@link stubRuntime} (no execution backend yet); the hosted backend
 * injects a SecEx-sandbox runtime via `setAgentRuntime` without touching any of
 * this orchestration.
 */

interface AgentRun {
	runId: string;
	sessionId: string;
	process: AgentProcess;
	interrupted: boolean;
	interruptAttempts: number;
	startedAt: number;
}

const runsBySessionId = new Map< string, AgentRun >();
const runsById = new Map< string, AgentRun >();

type Broadcast = ( event: AgentRunEvent ) => void;
let broadcast: Broadcast = () => {};

export function setBroadcast( fn: Broadcast ): void {
	broadcast = fn;
}

let runtime: AgentRuntime = stubRuntime;

export function setAgentRuntime( next: AgentRuntime ): void {
	runtime = next;
}

function nowIso(): string {
	return new Date().toISOString();
}

function emit( runId: string, sessionId: string, event: AgentEvent ): void {
	broadcast( { runId, sessionId, event } );
}

export interface StartAgentRunOptions {
	sessionId: string;
	prompt: string;
	displayMessage?: string;
}

export function startAgentRun( options: StartAgentRunOptions ): { runId: string } {
	const { sessionId, prompt, displayMessage } = options;

	if ( runsBySessionId.has( sessionId ) ) {
		throw new Error( `A run is already in progress for session ${ sessionId }` );
	}

	const runId = crypto.randomUUID();
	const startedAt = Date.now();

	const agentProcess = runtime.start( {
		sessionId,
		prompt,
		displayMessage,
		onSpawn: () => emit( runId, sessionId, { type: 'run.started', timestamp: nowIso() } ),
		onEvent: ( event ) => emit( runId, sessionId, event ),
		onError: ( message ) =>
			emit( runId, sessionId, { type: 'error', timestamp: nowIso(), message } ),
		onExit: ( code ) => {
			const interrupted = runsById.get( runId )?.interrupted ?? false;
			runsBySessionId.delete( sessionId );
			runsById.delete( runId );
			if ( interrupted ) {
				emit( runId, sessionId, { type: 'run.interrupted', timestamp: nowIso() } );
			}
			emit( runId, sessionId, {
				type: 'run.exited',
				timestamp: nowIso(),
				status: code === 0 ? 'success' : 'error',
				code,
			} );
		},
	} );

	const run: AgentRun = {
		runId,
		sessionId,
		process: agentProcess,
		interrupted: false,
		interruptAttempts: 0,
		startedAt,
	};
	runsBySessionId.set( sessionId, run );
	runsById.set( runId, run );

	return { runId };
}

export function listActiveAgentRuns(): ActiveAgentRun[] {
	return Array.from( runsBySessionId.values() ).map( ( run ) => ( {
		runId: run.runId,
		sessionId: run.sessionId,
		startedAt: run.startedAt,
		phase: run.interrupted ? 'interrupting' : 'running',
	} ) );
}

const INTERRUPT_FORCE_KILL_TIMEOUT_MS = 2000;

export function interruptAgentRun( runId: string ): void {
	const run = runsById.get( runId );
	if ( ! run ) {
		return;
	}
	run.interrupted = true;
	run.interruptAttempts += 1;
	if ( runsBySessionId.get( run.sessionId ) === run ) {
		runsBySessionId.delete( run.sessionId );
	}

	// A second interrupt request escalates straight to a force kill.
	if ( run.interruptAttempts > 1 ) {
		run.process.kill();
		return;
	}

	// First request: ask the agent to stop cleanly, then force-kill if it
	// hasn't exited within the grace window. If it can't be reached, kill now.
	if ( run.process.connected ) {
		run.process.interrupt();
		emit( run.runId, run.sessionId, { type: 'run.interrupting', timestamp: nowIso() } );
		setTimeout( () => {
			if ( runsById.get( runId ) === run ) {
				run.process.kill();
			}
		}, INTERRUPT_FORCE_KILL_TIMEOUT_MS ).unref();
		return;
	}

	run.process.kill();
}

export function answerAgentRun( runId: string, answers: Record< string, string > ): void {
	const run = runsById.get( runId );
	if ( ! run ) {
		return;
	}
	run.process.answer( answers );
}

export function answerAgentPermission(
	runId: string,
	requestId: string,
	decision: PermissionDecision
): void {
	const run = runsById.get( runId );
	if ( ! run ) {
		return;
	}
	run.process.answerPermission( requestId, decision );
}
