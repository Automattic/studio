import { fork, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import type { ActiveAgentRun, AgentEvent, AgentRunEvent } from '@studio/common/ai/agent-events';
import type { JsonEvent } from '@studio/common/ai/json-events';

/**
 * Headless analog of the desktop `run-manager` (apps/studio/src/modules/
 * ai-agent/run-manager.ts). It forks the exact same CLI subcommand the desktop
 * forks — `code sessions resume <id> <prompt> --json` — relays the child's
 * `JsonEvent`s as `AgentRunEvent`s, and synthesizes the same lifecycle events
 * (`run.started`, `run.exited`, ...). The only difference is the sink: instead
 * of `webContents.send`, events go to a broadcaster (SSE) injected via
 * `setBroadcast`.
 */

interface AgentRun {
	runId: string;
	sessionId: string;
	child: ChildProcess;
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

function nowIso(): string {
	return new Date().toISOString();
}

function send( run: AgentRun, event: AgentEvent ): void {
	broadcast( { runId: run.runId, sessionId: run.sessionId, event } );
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
	const args = [ 'code', 'sessions', 'resume', sessionId, prompt, '--json', '--avoid-telemetry' ];
	if ( displayMessage ) {
		args.push( '--display-message', displayMessage );
	}

	// Re-invoke this same CLI bundle. The child emits JSON transport events over
	// the Node IPC channel (process.send), which we read via `message`.
	const child = fork( process.argv[ 1 ], args, {
		stdio: [ 'ignore', 'inherit', 'inherit', 'ipc' ],
		execArgv: [ '--experimental-wasm-jspi' ],
		env: { ...process.env },
	} );

	const run: AgentRun = {
		runId,
		sessionId,
		child,
		interrupted: false,
		interruptAttempts: 0,
		startedAt,
	};

	runsBySessionId.set( sessionId, run );
	runsById.set( runId, run );

	child.on( 'spawn', () => {
		send( run, { type: 'run.started', timestamp: nowIso() } );
	} );

	child.on( 'message', ( message ) => {
		// The CLI's Logger also writes to this channel with a different shape;
		// forward only messages that look like the JSON transport envelope.
		if ( message && typeof message === 'object' && 'type' in message ) {
			send( run, message as JsonEvent );
		}
	} );

	child.on( 'error', ( error ) => {
		send( run, {
			type: 'error',
			timestamp: nowIso(),
			message: error.message || 'CLI subprocess failed to start',
		} );
	} );

	child.on( 'exit', ( code ) => {
		runsBySessionId.delete( sessionId );
		runsById.delete( runId );
		if ( run.interrupted ) {
			send( run, { type: 'run.interrupted', timestamp: nowIso() } );
		}
		send( run, {
			type: 'run.exited',
			timestamp: nowIso(),
			status: code === 0 ? 'success' : 'error',
			code,
		} );
	} );

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

	if ( run.interruptAttempts > 1 ) {
		run.child.kill( 'SIGKILL' );
		return;
	}

	if ( run.child.connected ) {
		run.child.send( { type: 'interrupt' } );
		send( run, { type: 'run.interrupting', timestamp: nowIso() } );
		setTimeout( () => {
			if ( runsById.get( runId ) === run && ! run.child.killed ) {
				run.child.kill( 'SIGKILL' );
			}
		}, INTERRUPT_FORCE_KILL_TIMEOUT_MS ).unref();
		return;
	}

	run.child.kill( 'SIGKILL' );
}

export function answerAgentRun( runId: string, answers: Record< string, string > ): void {
	const run = runsById.get( runId );
	if ( ! run || ! run.child.connected ) {
		return;
	}
	run.child.send( { type: 'answer', answers } );
}
