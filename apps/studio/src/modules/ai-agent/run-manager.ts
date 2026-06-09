import crypto from 'crypto';
import { fork, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { setAiSessionSitePlacement } from 'src/lib/ai-session-placement';
import {
	bumpStat,
	bumpAggregatedUniqueStat,
	getPlatformMetric,
	StatsGroup,
	StatsMetric,
} from 'src/lib/bump-stats';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';
import type { ActiveAgentRun, AgentRunEvent } from '@studio/common/ai/agent-events';
import type { StudioChatArtifactData } from '@studio/common/ai/chat-artifacts';
import type { StudioChatFileAttachment } from '@studio/common/ai/chat-files';
import type { StudioAiSessionInputPayload, StudioChatImage } from '@studio/common/ai/chat-images';
import type { JsonEvent } from '@studio/common/ai/json-events';
import type { WebContents } from 'electron';

interface AgentRun {
	runId: string;
	sessionId: string;
	child: ChildProcess;
	webContents: WebContents;
	interrupted: boolean;
	interruptAttempts: number;
	eventQueue: Promise< void >;
	startedAt: number;
}

// Two subprocesses resuming the same session id would race on the JSONL
// recorder, so we reject the second one here.
const runsBySessionId = new Map< string, AgentRun >();
const runsById = new Map< string, AgentRun >();

function nowIso(): string {
	return new Date().toISOString();
}

// The CLI subprocess runs with `--avoid-telemetry`, so the desktop side is the
// only place that records Studio Code assistant usage. Bump stats are simple
// counters: usage volume, run outcome, and unique active users.
function bumpCodeSendStat(): void {
	bumpStat( StatsGroup.STUDIO_CODE_UI_SEND, getPlatformMetric() );
	bumpAggregatedUniqueStat(
		StatsGroup.STUDIO_CODE_UI_WKLY_UNQ,
		getPlatformMetric(),
		'weekly'
	).catch( ( err ) => Sentry.captureException( err ) );
	bumpAggregatedUniqueStat(
		StatsGroup.STUDIO_CODE_UI_MON_UNQ,
		getPlatformMetric(),
		'monthly'
	).catch( ( err ) => Sentry.captureException( err ) );
}

function bumpCodeRunStat( run: AgentRun, code: number | null ): void {
	const outcome = run.interrupted
		? StatsMetric.INTERRUPTED
		: code === 0
		? StatsMetric.SUCCESS
		: StatsMetric.FAILURE;
	bumpStat( StatsGroup.STUDIO_CODE_UI_RUN, outcome );
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

function getCreatedSiteFromArtifact( artifact: StudioChatArtifactData ):
	| {
			siteId: string;
			sitePath: string;
			siteName: string;
	  }
	| undefined {
	for ( const widget of artifact.widgets ) {
		if ( widget.type !== 'site-preview' ) {
			continue;
		}
		const { siteId, sitePath, siteName } = widget.widgetProps;
		if (
			typeof siteId === 'string' &&
			typeof sitePath === 'string' &&
			typeof siteName === 'string'
		) {
			return { siteId, sitePath, siteName };
		}
	}
	return undefined;
}

async function applySessionPlacementFromEvent( run: AgentRun, event: JsonEvent ): Promise< void > {
	if ( event.type !== 'chat.artifact' ) {
		return;
	}
	const createdSite = getCreatedSiteFromArtifact( event.artifact );
	if ( ! createdSite ) {
		return;
	}
	const placement = await setAiSessionSitePlacement( run.sessionId, createdSite );
	if ( run.webContents.isDestroyed() ) {
		return;
	}
	run.webContents.send( 'ai-session-placement-updated', {
		sessionId: run.sessionId,
		placement,
	} );
}

async function sendQueuedJsonEvent( run: AgentRun, event: JsonEvent ): Promise< void > {
	try {
		await applySessionPlacementFromEvent( run, event );
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

export interface StartAgentRunOptions {
	sessionId: string;
	prompt: string;
	displayMessage?: string;
	images?: StudioChatImage[];
	files?: StudioChatFileAttachment[];
	webContents: WebContents;
}

// Attachments can be large (base64 image data) or numerous, so we hand them to
// the CLI child via a temp JSON file rather than process args, which have a
// platform-dependent length cap. The dir is removed when the run exits.
//
// The write is synchronous because `startAgentRun` is synchronous (it forks the
// child and returns a run id without awaiting). This blocks the main process for
// the write — bounded and one-time, and only meaningful at the max image batch
// (~12 MB → ~16 MB of base64 JSON). Kept sync to avoid a guard window where two
// concurrent sends for the same session could both pass the in-flight check.
function writeInputPayloadFile( payload: StudioAiSessionInputPayload ): {
	dir: string;
	path: string;
} {
	const dir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ai-run-' ) );
	const filePath = path.join( dir, 'input.json' );
	fs.writeFileSync( filePath, JSON.stringify( payload ), { encoding: 'utf8' } );
	return { dir, path: filePath };
}

export function startAgentRun( options: StartAgentRunOptions ): { runId: string } {
	const { sessionId, prompt, displayMessage, images = [], files = [], webContents } = options;

	if ( runsBySessionId.has( sessionId ) ) {
		throw new Error( `A run is already in progress for session ${ sessionId }` );
	}

	const runId = crypto.randomUUID();
	const startedAt = Date.now();
	const cliPath = getCliPath();
	const inputPayload =
		images.length > 0 || files.length > 0
			? writeInputPayloadFile( { prompt, displayMessage, images, files } )
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
	const child = fork( cliPath, args, {
		// Agent events arrive over the Node IPC channel (via `process.send`
		// in the child). stdout/stderr are ignored — the child's
		// `emitEvent` falls back to stdout only when IPC isn't available.
		stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ],
		execPath: getBundledNodeBinaryPath(),
		execArgv: [ '--experimental-wasm-jspi' ],
		env: { ...process.env },
	} );

	const run: AgentRun = {
		runId,
		sessionId,
		child,
		webContents,
		interrupted: false,
		interruptAttempts: 0,
		eventQueue: Promise.resolve(),
		startedAt,
	};

	runsBySessionId.set( sessionId, run );
	runsById.set( runId, run );

	bumpCodeSendStat();

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

	let didCleanup = false;
	const cleanup = ( code: number | null ) => {
		if ( didCleanup ) {
			return;
		}
		didCleanup = true;

		runsBySessionId.delete( sessionId );
		runsById.delete( runId );

		bumpCodeRunStat( run, code );

		void run.eventQueue.finally( async () => {
			if ( run.interrupted ) {
				sendEvent( run, { type: 'run.interrupted', timestamp: nowIso() } );
			}
			sendEvent( run, {
				type: 'run.exited',
				timestamp: nowIso(),
				status: code === 0 ? 'success' : 'error',
				code,
			} );
			if ( inputPayload ) {
				fs.rm( inputPayload.dir, { recursive: true, force: true }, ( error ) => {
					if ( error ) {
						console.warn( 'Failed to clean AI session input payload', error );
					}
				} );
			}
		} );
	};

	child.on( 'error', ( error ) => {
		sendEvent( run, {
			type: 'error',
			timestamp: nowIso(),
			message: error.message || 'CLI subprocess failed to start',
		} );
		cleanup( null );
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

export function answerAgentRun( runId: string, answers: Record< string, string > ): void {
	const run = runsById.get( runId );
	if ( ! run || ! run.child.connected ) {
		return;
	}
	run.child.send( { type: 'answer', answers } );
}
