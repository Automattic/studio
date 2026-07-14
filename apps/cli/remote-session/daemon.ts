import { spawn } from 'child_process';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import {
	DaemonAlreadyRunningError,
	DaemonStartTimeoutError,
	getDaemonStatus,
	isProcessAlive,
	readPid,
	removePidFile,
	writePidFile,
	type DaemonStatus,
	type StartDaemonResult,
	type StopDaemonResult,
} from '@studio/common/lib/remote-session';
import { getRemoteSessionPidPath } from '@studio/common/lib/well-known-paths';

// Re-export shared types/utilities so existing CLI-internal consumers (and
// tests) don't need to change their imports.
export { DaemonAlreadyRunningError, DaemonStartTimeoutError, getDaemonStatus };
export type { DaemonStatus, StartDaemonResult, StopDaemonResult };

/**
 * Env var the parent sets on the detached child so it knows to write its PID
 * and install cleanup hooks. Must be exactly the string "1" — see
 * `isDaemonChild()`.
 */
export const DAEMON_CHILD_ENV_VAR = 'STUDIO_REMOTE_SESSION_DAEMON_CHILD';

/** How long to wait after spawning the child for its PID file to appear. */
const PID_FILE_WAIT_MS = 5000;
/** How often we poll for the PID file while waiting. */
const PID_FILE_POLL_INTERVAL_MS = 100;

/** How long to wait for the daemon to exit after SIGTERM before SIGKILL. */
const DAEMON_STOP_TIMEOUT_MS = 5000;
/** How often we poll the PID for liveness while stopping. */
const DAEMON_STOP_POLL_INTERVAL_MS = 100;

export interface StartDaemonOptions {
	/** Args appended to the detached child after `code remote-session start`. */
	extraArgs?: string[];
	/** Override exec (Node) path; defaults to process.execPath. */
	execPath?: string;
	/** Override CLI entry path; defaults to process.argv[1]. */
	cliEntry?: string;
	/** Extra env to merge into the child's environment. */
	env?: NodeJS.ProcessEnv;
	/** Override the wait window for the PID file to appear. */
	pidFileWaitMs?: number;
}

export function isDaemonChild( env: NodeJS.ProcessEnv = process.env ): boolean {
	return env[ DAEMON_CHILD_ENV_VAR ] === '1';
}

/**
 * Called from inside the detached child once its config is validated. Writes
 * the current PID to disk and registers an `exit` handler that removes the
 * file when the daemon terminates. SIGINT/SIGTERM are intentionally left to
 * the caller (runRemoteSession installs its own graceful detach handler);
 * SIGHUP is caught here because the caller does not handle it and we want
 * the PID file removed even when the controlling terminal goes away.
 */
export function installDaemonChildHooks( pidFile: string = getRemoteSessionPidPath() ): {
	remove: () => void;
} {
	writePidFile( pidFile, process.pid );

	let removed = false;
	const remove = () => {
		if ( removed ) {
			return;
		}
		removed = true;
		removePidFile( pidFile );
	};

	const onExit = () => remove();
	const onSighup = () => {
		remove();
		process.exit( 0 );
	};

	process.once( 'exit', onExit );
	if ( process.platform !== 'win32' ) {
		process.once( 'SIGHUP', onSighup );
	}

	return { remove };
}

async function sleep( ms: number ): Promise< void > {
	await new Promise< void >( ( resolve ) => setTimeout( resolve, ms ) );
}

async function waitForPidFile(
	pidFile: string,
	expectedChildPid: number,
	timeoutMs: number
): Promise< number | undefined > {
	const deadline = Date.now() + timeoutMs;
	while ( Date.now() < deadline ) {
		const pid = readPid( pidFile );
		if ( pid !== undefined && isProcessAlive( pid ) ) {
			return pid;
		}
		// If the spawned child has already died without writing the PID file, stop early.
		if ( ! isProcessAlive( expectedChildPid ) ) {
			return undefined;
		}
		await sleep( PID_FILE_POLL_INTERVAL_MS );
	}
	return undefined;
}

/**
 * Spawn a detached `studio code remote-session start` process. Waits briefly for
 * the child to write its PID file, then returns. The returned PID is the
 * daemon's own PID (which equals the spawned child's PID, since we don't
 * double-fork).
 */
export async function startDaemon(
	options: StartDaemonOptions = {},
	pidFile: string = getRemoteSessionPidPath()
): Promise< StartDaemonResult > {
	const existing = getDaemonStatus( pidFile );
	if ( existing.running && existing.pid !== undefined ) {
		throw new DaemonAlreadyRunningError( existing.pid );
	}

	const execPath = options.execPath ?? process.execPath;
	const cliEntry = options.cliEntry ?? process.argv[ 1 ];
	if ( ! cliEntry ) {
		throw new Error( 'Cannot launch remote-session daemon: process.argv[1] is empty.' );
	}

	// `--no-detach` pins the child to foreground mode. Without it, the child
	// would re-read the now-default `--detach=true` and try to spawn its own
	// grandchild instead of running runRemoteSession + writing the PID file.
	const args = [
		cliEntry,
		'code',
		'remote-session',
		'start',
		'--no-detach',
		...( options.extraArgs ?? [] ),
	];
	const env = {
		...process.env,
		...options.env,
		[ DAEMON_CHILD_ENV_VAR ]: '1',
	};

	const child = spawn( execPath, args, {
		detached: true,
		stdio: 'ignore',
		windowsHide: true,
		env,
	} );

	if ( typeof child.pid !== 'number' ) {
		throw new Error( 'Failed to spawn remote-session daemon (no PID assigned).' );
	}

	// Detach so the parent can exit without keeping the child alive via stdio.
	child.unref();

	const pid = await waitForPidFile( pidFile, child.pid, options.pidFileWaitMs ?? PID_FILE_WAIT_MS );
	if ( pid === undefined ) {
		// Best-effort cleanup. The detached child is unref'd; if it's still
		// alive but never wrote the PID file, kill it so we don't leak it.
		if ( isProcessAlive( child.pid ) ) {
			try {
				process.kill( child.pid, 'SIGTERM' );
			} catch {
				// ignore
			}
		}
		throw new DaemonStartTimeoutError(
			`Remote-session daemon failed to start within ${
				options.pidFileWaitMs ?? PID_FILE_WAIT_MS
			}ms. Check ${ pidFile.replace( /\.pid$/, '.log' ) } for details.`
		);
	}

	return { pid, pidFile };
}

/**
 * Read the PID file and gracefully terminate the daemon. SIGTERM is sent first
 * (so the daemon can post its detach message and clean up); after a grace
 * period, SIGKILL is used. Removes the PID file once the process is confirmed
 * dead; if SIGKILL didn't take effect (PID reuse, missing permissions, etc.),
 * the PID file is left on disk and `stopped: false` is returned so `status`
 * keeps reporting accurately.
 *
 * Returns `{ stopped: true, alreadyStopped: true }` when the daemon was
 * already gone before we did anything.
 */
export async function stopDaemon(
	options: { timeoutMs?: number } = {},
	pidFile: string = getRemoteSessionPidPath()
): Promise< StopDaemonResult > {
	const pid = readPid( pidFile );
	if ( pid === undefined ) {
		return { stopped: true, alreadyStopped: true };
	}

	if ( ! isProcessAlive( pid ) ) {
		removePidFile( pidFile );
		return { stopped: true, pid, alreadyStopped: true };
	}

	try {
		process.kill( pid, 'SIGTERM' );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ESRCH' ) {
			removePidFile( pidFile );
			return { stopped: true, pid, alreadyStopped: true };
		}
		throw error;
	}

	const timeoutMs = options.timeoutMs ?? DAEMON_STOP_TIMEOUT_MS;
	const deadline = Date.now() + timeoutMs;
	while ( Date.now() < deadline ) {
		if ( ! isProcessAlive( pid ) ) {
			removePidFile( pidFile );
			return { stopped: true, pid };
		}
		await sleep( DAEMON_STOP_POLL_INTERVAL_MS );
	}

	let usedSigKill = false;
	try {
		process.kill( pid, 'SIGKILL' );
		usedSigKill = true;
	} catch ( error ) {
		if ( ! isErrnoException( error ) || error.code !== 'ESRCH' ) {
			throw error;
		}
	}

	// Give SIGKILL a brief moment to take effect.
	const killDeadline = Date.now() + 1000;
	while ( Date.now() < killDeadline ) {
		if ( ! isProcessAlive( pid ) ) {
			removePidFile( pidFile );
			return { stopped: true, pid, usedSigKill };
		}
		await sleep( DAEMON_STOP_POLL_INTERVAL_MS );
	}

	// Process refused to die. Leave the PID file in place so `status` keeps
	// telling the truth and the user can investigate.
	return { stopped: false, pid, usedSigKill };
}
