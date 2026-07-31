import { fork, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordAgentRun, recordAgentSend, type AgentSurface } from '@studio/common/ai/agent-stats';
import {
	getCreatedSiteFromArtifact,
	setAiSessionSitePlacement,
	type AiSessionPlacementUpdatedEvent,
} from '@studio/common/ai/sessions/placement';
import { captureException } from '@studio/common/lib/error-reporting';
import type { ActiveAgentRun, AgentRunEvent } from '@studio/common/ai/agent-events';
import type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import type { StudioAiSessionInputPayload, StudioChatImage } from '@studio/common/ai/chat-images';
import type { JsonEvent } from '@studio/common/ai/json-events';
import type { StudioVisualAnnotationSummary } from '@studio/common/ai/visual-annotations';

/**
 * Runs the Studio Code agent as a CLI child process: forks the CLI
 * (`code sessions resume …`), relays the agent's JSON transport events, owns the
 * run lifecycle (ids, ordering, interrupt policy), records usage stats, persists
 * session placement, and reports errors to Sentry.
 *
 * Two things are injected via {@link AgentRunManagerConfig}: which CLI binary to
 * fork, and how run output reaches the UI ({@link emit}). `surface` tags
 * telemetry so stat groups don't conflate.
 */

interface AgentRun {
	runId: string;
	sessionId: string;
	child: ChildProcess;
	interrupted: boolean;
	interruptAttempts: number;
	eventQueue: Promise< void >;
	startedAt: number;
}

// Everything a run produces for the UI. The host maps each kind to its transport
// (desktop → the `ai-agent-event` / `ai-session-placement-updated` IPC channels;
// server → the SSE `agent` / `placement` channels).
export type RunManagerOutput =
	| { kind: 'agent'; runId: string; event: AgentRunEvent }
	| { kind: 'placement'; runId: string; event: AiSessionPlacementUpdatedEvent };

export interface AgentRunManagerConfig {
	// Absolute path to the CLI entry to fork (e.g. `.../cli/main.mjs`).
	cliBinary: string;
	// Node binary to fork with. Defaults to `process.execPath`. The desktop
	// overrides this with its bundled Node (its own `execPath` is Electron).
	nodeBinary?: string;
	// Extra Node flags for the child; the agent runs Playground, so JSPI is on.
	execArgv?: string[];
	// Where run output goes. The host adapts this to its transport.
	emit: ( output: RunManagerOutput ) => void;
	// Telemetry surface, so desktop and `studio ui` stats stay distinct.
	surface: AgentSurface;
}

export interface StartAgentRunOptions {
	sessionId: string;
	prompt: string;
	displayMessage?: string;
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
	visualAnnotations?: StudioVisualAnnotationSummary[];
}

export interface AgentRunManager {
	startAgentRun( options: StartAgentRunOptions ): { runId: string };
	listActiveAgentRuns(): ActiveAgentRun[];
	interruptAgentRun( runId: string ): void;
	answerAgentRun( runId: string, answers: Record< string, string > ): void;
}

const INTERRUPT_FORCE_KILL_TIMEOUT_MS = 2000;

function nowIso(): string {
	return new Date().toISOString();
}

// Attachments can be large (base64 image data) or numerous, so we hand them to
// the CLI child via a temp JSON file rather than process args, which have a
// platform-dependent length cap. The dir is removed when the run exits.
function writeInputPayloadFile( payload: StudioAiSessionInputPayload ): {
	dir: string;
	path: string;
} {
	const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ai-run-' ) );
	const filePath = path.join( dir, 'input.json' );
	fs.writeFileSync( filePath, JSON.stringify( payload ), { encoding: 'utf8' } );
	return { dir, path: filePath };
}

export function createAgentRunManager( config: AgentRunManagerConfig ): AgentRunManager {
	const { cliBinary, nodeBinary, execArgv = [ '--experimental-wasm-jspi' ], surface } = config;

	// Two subprocesses resuming the same session id would race on the JSONL
	// recorder, so we reject the second one here.
	const runsBySessionId = new Map< string, AgentRun >();
	const runsById = new Map< string, AgentRun >();

	function sendEvent( run: AgentRun, event: AgentRunEvent[ 'event' ] ): void {
		config.emit( {
			kind: 'agent',
			runId: run.runId,
			event: { runId: run.runId, sessionId: run.sessionId, event },
		} );
	}

	// When the agent reports it created a site, bind the session to it and tell
	// the UI. Persisted to app.json.
	async function applyPlacementFromEvent( run: AgentRun, event: JsonEvent ): Promise< void > {
		if ( event.type !== 'chat.artifact' ) {
			return;
		}
		const createdSite = getCreatedSiteFromArtifact( event.artifact );
		if ( ! createdSite ) {
			return;
		}
		const placement = await setAiSessionSitePlacement( run.sessionId, createdSite );
		config.emit( {
			kind: 'placement',
			runId: run.runId,
			event: { sessionId: run.sessionId, placement },
		} );
	}

	async function sendQueuedJsonEvent( run: AgentRun, event: JsonEvent ): Promise< void > {
		try {
			await applyPlacementFromEvent( run, event );
		} catch ( error ) {
			sendEvent( run, {
				type: 'error',
				timestamp: nowIso(),
				message: error instanceof Error ? error.message : 'Failed to update session placement',
			} );
		}
		sendEvent( run, event );
	}

	function enqueueJsonEvent( run: AgentRun, event: JsonEvent ): void {
		run.eventQueue = run.eventQueue
			.then( () => sendQueuedJsonEvent( run, event ) )
			.catch( ( error ) => {
				sendEvent( run, {
					type: 'error',
					timestamp: nowIso(),
					message: error instanceof Error ? error.message : 'Failed to forward agent event',
				} );
			} );
	}

	function startAgentRun( options: StartAgentRunOptions ): { runId: string } {
		const {
			sessionId,
			prompt,
			displayMessage,
			images = [],
			files = [],
			visualAnnotations,
		} = options;

		if ( runsBySessionId.has( sessionId ) ) {
			throw new Error( `A run is already in progress for session ${ sessionId }` );
		}

		const runId = crypto.randomUUID();
		const startedAt = Date.now();
		const inputPayload =
			images.length > 0 || files.length > 0 || visualAnnotations
				? writeInputPayloadFile( { prompt, displayMessage, images, files, visualAnnotations } )
				: undefined;
		const args = [ 'code', 'sessions', 'resume', sessionId ];
		if ( inputPayload ) {
			args.push( '--input-payload', inputPayload.path );
		} else {
			args.push( prompt );
		}
		args.push( '--json', '--avoid-telemetry' );
		if ( displayMessage && ! inputPayload ) {
			args.push( '--display-message', displayMessage );
		}
		const child = fork( cliBinary, args, {
			// Agent events arrive over the Node IPC channel (via `process.send`
			// in the child). stdout/stderr are ignored — the child's `emitEvent`
			// falls back to stdout only when IPC isn't available.
			stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ],
			execPath: nodeBinary,
			execArgv,
			env: { ...process.env },
		} );

		const run: AgentRun = {
			runId,
			sessionId,
			child,
			interrupted: false,
			interruptAttempts: 0,
			eventQueue: Promise.resolve(),
			startedAt,
		};

		runsBySessionId.set( sessionId, run );
		runsById.set( runId, run );

		recordAgentSend( surface );

		child.on( 'spawn', () => {
			sendEvent( run, { type: 'run.started', timestamp: nowIso() } );
		} );

		child.on( 'message', ( message ) => {
			// The CLI's `Logger` also writes to this IPC channel with a different
			// shape (`{ action, status, message }`) on error paths. Forward only
			// messages that look like the CLI JSON transport envelope.
			if ( message && typeof message === 'object' && 'type' in message ) {
				enqueueJsonEvent( run, message as JsonEvent );
			}
		} );

		const cleanup = ( code: number | null ) => {
			runsBySessionId.delete( sessionId );
			runsById.delete( runId );

			recordAgentRun( surface, { interrupted: run.interrupted, code } );

			if ( inputPayload ) {
				fs.rm( inputPayload.dir, { recursive: true, force: true }, ( error ) => {
					if ( error ) {
						console.warn( 'Failed to clean AI session input payload', error );
					}
				} );
			}

			void run.eventQueue.finally( () => {
				if ( run.interrupted ) {
					sendEvent( run, { type: 'run.interrupted', timestamp: nowIso() } );
				}
				sendEvent( run, {
					type: 'run.exited',
					timestamp: nowIso(),
					status: code === 0 ? 'success' : 'error',
					code,
				} );
			} );
		};

		child.on( 'error', ( error ) => {
			captureException( error );
			sendEvent( run, {
				type: 'error',
				timestamp: nowIso(),
				message: error.message || 'CLI subprocess failed to start',
			} );
		} );

		child.on( 'exit', cleanup );

		return { runId };
	}

	function listActiveAgentRuns(): ActiveAgentRun[] {
		return Array.from( runsBySessionId.values() ).map( ( run ) => ( {
			runId: run.runId,
			sessionId: run.sessionId,
			startedAt: run.startedAt,
			phase: run.interrupted ? 'interrupting' : 'running',
		} ) );
	}

	function interruptAgentRun( runId: string ): void {
		const run = runsById.get( runId );
		if ( ! run ) {
			return;
		}
		run.interrupted = true;
		run.interruptAttempts += 1;
		if ( runsBySessionId.get( run.sessionId ) === run ) {
			runsBySessionId.delete( run.sessionId );
		}

		// Second click escalates: the graceful path is in flight but evidently
		// not landing fast enough, so skip the grace period.
		if ( run.interruptAttempts > 1 ) {
			run.child.kill( 'SIGKILL' );
			return;
		}

		// First click: tell the child to interrupt via the Agent SDK and exit
		// cleanly (so the session recorder flushes). SIGTERM is swallowed by
		// module-level handlers that aren't wired to the SDK, so we use IPC.
		if ( run.child.connected ) {
			run.child.send( { type: 'interrupt' } );
			sendEvent( run, { type: 'run.interrupting', timestamp: nowIso() } );
			// Safety net: if the graceful path doesn't land quickly, force-kill
			// so the renderer can't get stuck in a busy state.
			setTimeout( () => {
				if ( runsById.get( runId ) === run && ! run.child.killed ) {
					run.child.kill( 'SIGKILL' );
				}
			}, INTERRUPT_FORCE_KILL_TIMEOUT_MS ).unref();
			return;
		}

		run.child.kill( 'SIGKILL' );
	}

	function answerAgentRun( runId: string, answers: Record< string, string > ): void {
		const run = runsById.get( runId );
		if ( ! run || ! run.child.connected ) {
			return;
		}
		run.child.send( { type: 'answer', answers } );
	}

	return { startAgentRun, listActiveAgentRuns, interruptAgentRun, answerAgentRun };
}
