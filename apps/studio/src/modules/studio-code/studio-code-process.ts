import { app } from 'electron';
import { ChildProcess, fork } from 'node:child_process';
import * as Sentry from '@sentry/electron/main';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getBundledNodeBinaryPath, getCliPath } from 'src/storage/paths';
import type { StudioCodeEvent } from './studio-code-event-types';

interface SiteSession {
	activeTurn: ChildProcess | null;
	appQuitHandler: ( () => void ) | null;
	lastSessionId: string | null;
	interruptAttempts: number;
}

// Module-level registry keyed by siteId
const sessions = new Map< string, SiteSession >();

// Grace period before escalating a graceful interrupt to SIGKILL. The first
// abort asks the CLI to interrupt over IPC (so the session recorder flushes);
// if it doesn't land quickly, we force-kill so the chat can't stay stuck busy.
const INTERRUPT_FORCE_KILL_TIMEOUT_MS = 2000;

function getOrCreateSession( siteId: string ): SiteSession {
	let session = sessions.get( siteId );
	if ( ! session ) {
		session = { activeTurn: null, appQuitHandler: null, lastSessionId: null, interruptAttempts: 0 };
		sessions.set( siteId, session );
	}
	return session;
}

function forceKill( session: SiteSession ): void {
	if ( session.appQuitHandler ) {
		app.off( 'will-quit', session.appQuitHandler );
		session.appQuitHandler = null;
	}
	if ( session.activeTurn ) {
		session.activeTurn.removeAllListeners();
		session.activeTurn.kill( 'SIGKILL' );
		session.activeTurn = null;
	}
}

// Graceful interrupt: tell the CLI child to interrupt via the Agent SDK and
// exit cleanly. SIGTERM is swallowed by module-level handlers (e.g.
// wordpress-server-manager) that aren't wired to the SDK, so we use the Node
// IPC `interrupt` message — mirroring `ai-agent/run-manager.ts`. A second
// abort, or a disconnected child, escalates straight to SIGKILL.
function interruptTurn( session: SiteSession ): void {
	const child = session.activeTurn;
	if ( ! child ) {
		return;
	}

	session.interruptAttempts += 1;

	if ( session.interruptAttempts > 1 || ! child.connected ) {
		forceKill( session );
		return;
	}

	child.send( { type: 'interrupt' } );

	// Safety net: force-kill if the graceful path doesn't land in time.
	setTimeout( () => {
		if ( session.activeTurn === child && ! child.killed ) {
			forceKill( session );
		}
	}, INTERRUPT_FORCE_KILL_TIMEOUT_MS ).unref();
}

export function spawnTurn(
	siteId: string,
	sitePath: string,
	siteName: string,
	message: string,
	options?: {
		resumeSessionId?: string;
	}
): void {
	const session = getOrCreateSession( siteId );

	// Kill any active turn for this site
	forceKill( session );
	session.interruptAttempts = 0;

	const nodePath = getBundledNodeBinaryPath();
	const cliPath = getCliPath();

	const args = [ 'code', message, '--json', '--path', sitePath, '--site-name', siteName ];

	const sessionId = options?.resumeSessionId ?? session.lastSessionId;
	if ( sessionId ) {
		args.push( '--resume-session', sessionId );
	}

	const child = fork( cliPath, args, {
		// Agent events arrive over the Node IPC channel (via `process.send` in
		// the child); `emitEvent` prefers it when available. stdio is otherwise
		// ignored — we no longer parse NDJSON from stdout.
		stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ],
		execPath: nodePath,
		execArgv: [ '--experimental-wasm-jspi' ],
		env: { ...process.env },
	} );

	session.activeTurn = child;

	child.on( 'message', ( message ) => {
		// The CLI's `Logger` also writes to this IPC channel with a different
		// shape (`{ action, status, message }`). Forward only the CLI JSON
		// transport envelope.
		if ( ! message || typeof message !== 'object' || ! ( 'type' in message ) ) {
			return;
		}
		const event = message as StudioCodeEvent;

		if ( event.type === 'turn.completed' && event.sessionId ) {
			session.lastSessionId = event.sessionId;
		}

		void sendIpcEventToRenderer( 'studio-code-event', { siteId, event } );
	} );

	child.on( 'error', ( error ) => {
		console.error( `[StudioCode - ${ siteId }] Process error:`, error );
		Sentry.captureException( error );
	} );

	child.on( 'exit', ( exitCode, signal ) => {
		console.info(
			`[StudioCode - ${ siteId }] Process exited with code ${ exitCode }, signal ${ signal }`
		);
		if ( session.appQuitHandler ) {
			app.off( 'will-quit', session.appQuitHandler );
			session.appQuitHandler = null;
		}
		if ( session.activeTurn === child ) {
			session.activeTurn = null;
		}
	} );

	const appQuitHandler = () => forceKill( session );
	session.appQuitHandler = appQuitHandler;
	app.on( 'will-quit', appQuitHandler );
}

// Deliver a permission/question answer to the live CLI child. The CLI's
// `JsonAdapter.askUser` is awaiting this IPC message and resumes the same turn.
export function answerTurn( siteId: string, answers: Record< string, string > ): void {
	const session = sessions.get( siteId );
	const child = session?.activeTurn;
	if ( child?.connected ) {
		child.send( { type: 'answer', answers } );
	}
}

export function abortTurn( siteId: string ): void {
	const session = sessions.get( siteId );
	if ( session ) {
		interruptTurn( session );
	}
}

export function stopAllProcesses(): void {
	for ( const [ , session ] of sessions ) {
		forceKill( session );
	}
	sessions.clear();
}
