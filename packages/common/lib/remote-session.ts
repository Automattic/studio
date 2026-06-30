/**
 * Shared remote-session daemon types and PID-file helpers.
 *
 * Lives in `@studio/common` so the CLI (which spawns the daemon) and the
 * desktop app (which reads its status and triggers start/stop via the CLI
 * subprocess) can both depend on the same vocabulary without one workspace
 * reaching into the other's source tree.
 */
import fs from 'fs';
import path from 'path';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { getRemoteSessionPidPath } from '@studio/common/lib/well-known-paths';

export interface DaemonStatus {
	running: boolean;
	pid?: number;
	pidFile: string;
	staleFileRemoved?: boolean;
}

/**
 * Trimmed-down view of `DaemonStatus` for IPC consumers (the desktop
 * renderer). Only the bits the UI actually needs cross the process
 * boundary — keeping the on-disk `pidFile`, the running `pid`, and the
 * stale-file bookkeeping flag on the main-process side avoids shipping
 * data the renderer never reads.
 */
export interface RemoteSessionStatus {
	running: boolean;
}

export function toRemoteSessionStatus( status: DaemonStatus ): RemoteSessionStatus {
	return { running: status.running };
}

export interface DaemonStatusPollerOptions< T > {
	/** Returns the current status snapshot. Called on every tick. */
	readStatus: () => T;
	/** Sink for status. Called for every value that passes `shouldPush`. */
	pushStatus: ( status: T ) => void;
	/** Poll interval in ms. Defaults to 5000. */
	intervalMs?: number;
	/**
	 * Pre-flight gate. When provided and returning false, no polling happens
	 * and a no-op stop function is returned immediately. Used by the CLI to
	 * skip polling when `STUDIO_ENABLE_REMOTE_SESSION` is off.
	 */
	isEnabled?: () => boolean;
	/**
	 * Filter that decides whether the current status should be pushed.
	 * Receives `(current, lastPushed)` and defaults to "push every tick".
	 * Studio's renderer poller uses this to dedupe across ticks where
	 * `running` hasn't changed, avoiding renderer churn every 5 seconds.
	 */
	shouldPush?: ( current: T, lastPushed: T | undefined ) => boolean;
}

const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Shared polling skeleton for the remote-session daemon. Both the desktop
 * main process (which forwards status into the renderer via IPC) and the CLI
 * REPL (which pushes into its bottom-bar status indicator) use this; only
 * their sinks differ.
 *
 * Disciplines:
 *
 * - Fires one synchronous tick before scheduling the interval so first paint
 *   doesn't wait `intervalMs`.
 * - Wraps every `readStatus` call in try/catch — a transient PID-file read
 *   error must never crash the loop; the next tick will try again.
 * - Calls `timer.unref()` so the poller can't keep Electron / the CLI alive
 *   during quit.
 *
 * The returned stop function clears the interval. It deliberately does NOT
 * touch the daemon itself — the daemon's lifecycle is independent.
 */
export function pollDaemonStatus< T >( options: DaemonStatusPollerOptions< T > ): () => void {
	const isEnabled = options.isEnabled ?? ( () => true );
	if ( ! isEnabled() ) {
		return () => undefined;
	}

	const shouldPush = options.shouldPush ?? ( () => true );
	let lastPushed: T | undefined;

	const tick = () => {
		try {
			const current = options.readStatus();
			if ( shouldPush( current, lastPushed ) ) {
				lastPushed = current;
				options.pushStatus( current );
			}
		} catch {
			// Reading the PID file is best-effort. A transient read error must
			// not crash the loop; the next tick will try again.
		}
	};

	tick();
	const timer = setInterval( tick, options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS );
	if ( typeof timer.unref === 'function' ) {
		timer.unref();
	}
	return () => clearInterval( timer );
}

export interface StartDaemonResult {
	pid: number;
	pidFile: string;
}

export interface StopDaemonResult {
	stopped: boolean;
	pid?: number;
	usedSigKill?: boolean;
	alreadyStopped?: boolean;
}

export class DaemonAlreadyRunningError extends Error {
	constructor( public readonly pid: number ) {
		super( `Remote-session daemon is already running (PID ${ pid })` );
		this.name = 'DaemonAlreadyRunningError';
	}
}

export class DaemonStartTimeoutError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'DaemonStartTimeoutError';
	}
}

export function readPid( pidFile: string ): number | undefined {
	let raw: string;
	try {
		raw = fs.readFileSync( pidFile, 'utf8' );
	} catch {
		return undefined;
	}
	const parsed = Number.parseInt( raw.trim(), 10 );
	if ( ! Number.isFinite( parsed ) || parsed <= 0 ) {
		return undefined;
	}
	return parsed;
}

export function isProcessAlive( pid: number ): boolean {
	try {
		process.kill( pid, 0 );
		return true;
	} catch ( error ) {
		// EPERM means the process exists but we can't signal it — still "alive".
		return isErrnoException( error ) && error.code === 'EPERM';
	}
}

export function removePidFile( pidFile: string ): void {
	try {
		fs.rmSync( pidFile, { force: true } );
	} catch {
		// best-effort
	}
}

export function writePidFile( pidFile: string, pid: number ): void {
	// Defensive: ~/.studio is normally created by the migration middleware and
	// the logger, but this module shouldn't depend on that ordering.
	try {
		fs.mkdirSync( path.dirname( pidFile ), { recursive: true } );
	} catch {
		// best-effort; the writeFileSync below will surface a real error.
	}
	fs.writeFileSync( pidFile, `${ pid }\n`, { encoding: 'utf8', mode: 0o600 } );
	if ( process.platform !== 'win32' ) {
		try {
			fs.chmodSync( pidFile, 0o600 );
		} catch {
			// chmod can fail for various reasons; mode was set on create.
		}
	}
}

/**
 * Inspect the on-disk PID file and report whether a daemon is currently running.
 * Removes the PID file when it points to a dead process.
 */
export function getDaemonStatus( pidFile: string = getRemoteSessionPidPath() ): DaemonStatus {
	const pid = readPid( pidFile );
	if ( pid === undefined ) {
		return { running: false, pidFile };
	}
	if ( isProcessAlive( pid ) ) {
		return { running: true, pid, pidFile };
	}
	removePidFile( pidFile );
	return { running: false, pid, pidFile, staleFileRemoved: true };
}
