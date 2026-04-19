import crypto from 'crypto';
import { type WebContents } from 'electron';
import { fork, type ChildProcess } from 'node:child_process';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';
import type { JsonEvent } from '@studio/common/ai/json-events';
import type { AgentRunEvent } from './types';

interface AgentRun {
	runId: string;
	sessionId: string;
	child: ChildProcess;
	webContents: WebContents;
	stdoutBuffer: string;
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

function parseAndEmitNdjson( run: AgentRun, chunk: string ): void {
	run.stdoutBuffer += chunk;
	let newlineIndex = run.stdoutBuffer.indexOf( '\n' );
	while ( newlineIndex !== -1 ) {
		const line = run.stdoutBuffer.slice( 0, newlineIndex ).trim();
		run.stdoutBuffer = run.stdoutBuffer.slice( newlineIndex + 1 );
		if ( line ) {
			try {
				sendEvent( run, JSON.parse( line ) as JsonEvent );
			} catch {
				// Ignore non-JSON lines on stdout.
			}
		}
		newlineIndex = run.stdoutBuffer.indexOf( '\n' );
	}
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
		[
			'code',
			'sessions',
			'resume',
			sessionId,
			prompt,
			'--json',
			'--auto-approve',
			'--avoid-telemetry',
		],
		{
			stdio: [ 'ignore', 'pipe', 'pipe', 'ipc' ],
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
		stdoutBuffer: '',
		interrupted: false,
	};

	runsBySessionId.set( sessionId, run );
	runsById.set( runId, run );

	child.on( 'spawn', () => {
		sendEvent( run, { type: 'run.started', timestamp: nowIso() } );
	} );

	child.stdout?.setEncoding( 'utf8' );
	child.stdout?.on( 'data', ( data: string ) => {
		parseAndEmitNdjson( run, data );
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

	child.on( 'exit', ( code ) => {
		// Flush any trailing buffered line without a terminating newline.
		if ( run.stdoutBuffer.trim() ) {
			parseAndEmitNdjson( run, '\n' );
		}
		cleanup( code );
	} );

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
