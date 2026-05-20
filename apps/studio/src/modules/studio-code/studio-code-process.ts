import { app } from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import readline from 'node:readline';
import * as Sentry from '@sentry/electron/main';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { getCliPath } from 'src/storage/paths';
import type { StudioCodeEvent } from './studio-code-event-types';

interface SiteSession {
	activeTurn: ChildProcess | null;
	activeTurnRl: readline.Interface | null;
	appQuitHandler: ( () => void ) | null;
	lastSessionId: string | null;
}

// Module-level registry keyed by siteId
const sessions = new Map< string, SiteSession >();

function getOrCreateSession( siteId: string ): SiteSession {
	let session = sessions.get( siteId );
	if ( ! session ) {
		session = { activeTurn: null, activeTurnRl: null, appQuitHandler: null, lastSessionId: null };
		sessions.set( siteId, session );
	}
	return session;
}

function cleanupTurn( session: SiteSession ): void {
	if ( session.appQuitHandler ) {
		app.off( 'will-quit', session.appQuitHandler );
		session.appQuitHandler = null;
	}
	session.activeTurnRl?.close();
	session.activeTurnRl = null;
	if ( session.activeTurn ) {
		session.activeTurn.removeAllListeners();
		session.activeTurn.kill();
		session.activeTurn = null;
	}
}

export function spawnTurn(
	siteId: string,
	sitePath: string,
	siteName: string,
	message: string,
	options?: {
		resumeSessionId?: string;
		permissionResponse?: Record< string, string >;
	}
): void {
	const session = getOrCreateSession( siteId );

	// Kill any active turn for this site
	cleanupTurn( session );

	const cliPath = getCliPath();

	const args = [
		cliPath,
		'code',
		message,
		'--json',
		'--path',
		sitePath,
		'--site-name',
		siteName,
	];

	const sessionId = options?.resumeSessionId ?? session.lastSessionId;
	if ( sessionId ) {
		args.push( '--resume-session', sessionId );
	}

	if ( options?.permissionResponse ) {
		args.push( '--permission-response', JSON.stringify( options.permissionResponse ) );
	}

	// Run the Electron binary as Node via ELECTRON_RUN_AS_NODE=1. We deliberately
	// use spawn (not fork) so the child does NOT get a Node IPC channel — the
	// CLI's `emitEvent` falls back to NDJSON on stdout when `process.send` is
	// undefined, which is what the readline parser below consumes.
	const child = spawn( process.execPath, args, {
		stdio: [ 'pipe', 'pipe', 'pipe' ],
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
	} );

	session.activeTurn = child;

	const rl = readline.createInterface( { input: child.stdout! } );
	session.activeTurnRl = rl;

	rl.on( 'line', ( line ) => {
		try {
			const event: StudioCodeEvent = JSON.parse( line );

			if ( event.type === 'turn.completed' && event.sessionId ) {
				session.lastSessionId = event.sessionId;
			}

			void sendIpcEventToRenderer( 'studio-code-event', { siteId, event } );
		} catch {
			console.error( `[StudioCode - ${ siteId }] Non-JSON stdout line:`, line );
		}
	} );

	child.stderr?.on( 'data', ( data: Buffer ) => {
		const text = data.toString().trimEnd();
		if ( text ) {
			console.error( `[StudioCode - ${ siteId }] stderr:`, text );
		}
	} );

	child.on( 'error', ( error ) => {
		console.error( `[StudioCode - ${ siteId }] Process error:`, error );
		Sentry.captureException( error );
	} );

	child.on( 'close', ( exitCode, signal ) => {
		console.info(
			`[StudioCode - ${ siteId }] Process exited with code ${ exitCode }, signal ${ signal }`
		);
		rl.close();
		if ( session.appQuitHandler ) {
			app.off( 'will-quit', session.appQuitHandler );
			session.appQuitHandler = null;
		}
		if ( session.activeTurn === child ) {
			session.activeTurn = null;
			session.activeTurnRl = null;
		}
	} );

	const appQuitHandler = () => cleanupTurn( session );
	session.appQuitHandler = appQuitHandler;
	app.on( 'will-quit', appQuitHandler );
}

export function abortTurn( siteId: string ): void {
	const session = sessions.get( siteId );
	if ( session ) {
		cleanupTurn( session );
	}
}

export function stopAllProcesses(): void {
	for ( const [ , session ] of sessions ) {
		cleanupTurn( session );
	}
	sessions.clear();
}
