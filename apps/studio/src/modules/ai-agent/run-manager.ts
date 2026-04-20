import crypto from 'crypto';
import { fork, type ChildProcess } from 'node:child_process';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';
import type { AgentRunEvent } from './types';
import type { JsonEvent } from '@studio/common/ai/json-events';
import type { WebContents } from 'electron';

interface AgentRun {
	runId: string;
	sessionId: string;
	child: ChildProcess;
	webContents: WebContents;
	interrupted: boolean;
}

// Two subprocesses resuming the same session id would race on the JSONL
// recorder, so we reject the second one here.
const runsBySessionId = new Map< string, AgentRun >();
const runsById = new Map< string, AgentRun >();

function nowIso(): string {
	return new Date().toISOString();
}

function sendEvent( run: AgentRun, event: AgentRunEvent[ 'event' ] ): void {
	if ( run.webContents.isDestroyed() ) {
		return;
	}
	const payload: AgentRunEvent = {
		runId: run.runId,
		sessionId: run.sessionId,
		event,
	};
	run.webContents.send( 'ai-agent-event', payload );
}

export interface StartAgentRunOptions {
	sessionId: string;
	prompt: string;
	webContents: WebContents;
}

export function startAgentRun( options: StartAgentRunOptions ): { runId: string } {
	const { sessionId, prompt, webContents } = options;

	if ( runsBySessionId.has( sessionId ) ) {
		throw new Error( `A run is already in progress for session ${ sessionId }` );
	}

	const runId = crypto.randomUUID();
	const cliPath = getCliPath();
	const child = fork(
		cliPath,
		[ 'code', 'sessions', 'resume', sessionId, prompt, '--json', '--avoid-telemetry' ],
		{
			// Agent events arrive over the Node IPC channel (via `process.send`
			// in the child). stdout/stderr are ignored — the child's
			// `emitEvent` falls back to stdout only when IPC isn't available.
			stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ],
			execPath: getBundledNodeBinaryPath(),
			execArgv: [ '--experimental-wasm-jspi' ],
			env: { ...process.env },
		}
	);

	const run: AgentRun = {
		runId,
		sessionId,
		child,
		webContents,
		interrupted: false,
	};

	runsBySessionId.set( sessionId, run );
	runsById.set( runId, run );

	child.on( 'spawn', () => {
		sendEvent( run, { type: 'run.started', timestamp: nowIso() } );
	} );

	child.on( 'message', ( message ) => {
		// The CLI's `Logger` also writes to this IPC channel with a different
		// shape (`{ action, status, message }`) on error paths. Forward only
		// messages that look like a JsonEvent.
		if ( message && typeof message === 'object' && 'type' in message ) {
			sendEvent( run, message as JsonEvent );
		}
	} );

	const cleanup = ( code: number | null ) => {
		runsBySessionId.delete( sessionId );
		runsById.delete( runId );

		if ( run.interrupted ) {
			sendEvent( run, { type: 'run.interrupted', timestamp: nowIso() } );
		}
		sendEvent( run, {
			type: 'run.exited',
			timestamp: nowIso(),
			status: code === 0 ? 'success' : 'error',
			code,
		} );
	};

	child.on( 'error', ( error ) => {
		sendEvent( run, {
			type: 'error',
			timestamp: nowIso(),
			message: error.message || 'CLI subprocess failed to start',
		} );
	} );

	child.on( 'exit', cleanup );

	const abortOnDestroy = () => {
		if ( ! runsById.has( runId ) ) {
			return;
		}
		interruptAgentRun( runId );
	};
	webContents.once( 'destroyed', abortOnDestroy );

	return { runId };
}

export function interruptAgentRun( runId: string ): void {
	const run = runsById.get( runId );
	if ( ! run ) {
		return;
	}
	run.interrupted = true;
	run.child.kill();
}

export function answerAgentRun( runId: string, answers: Record< string, string > ): void {
	const run = runsById.get( runId );
	if ( ! run || ! run.child.connected ) {
		return;
	}
	run.child.send( { type: 'answer', answers } );
}
