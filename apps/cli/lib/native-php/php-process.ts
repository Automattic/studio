import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { getPhpBinaryPath } from 'cli/lib/dependency-management/paths';
import { getDefaultPhpArgs } from 'cli/lib/native-php/config';
import type { NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';

type ErrorLogger = ( ...args: Parameters< typeof console.error > ) => void;

// The tail, because PHP reports the fatal last, and capped so a chatty process (the Blueprint
// runner emits a progress line per step) can't grow the buffer without bound.
export const MAX_CAPTURED_OUTPUT_CHARS = 64 * 1024;

// Carries the output so callers can report why PHP exited, not just that it did.
export class PhpCommandError extends Error {
	constructor(
		message: string,
		readonly exitCode: number | null,
		readonly stdout: string,
		readonly stderr: string
	) {
		super( message );
		this.name = 'PhpCommandError';
	}
}

function appendBounded( buffer: string, chunk: string ): string {
	const combined = buffer + chunk;
	return combined.length > MAX_CAPTURED_OUTPUT_CHARS
		? combined.slice( combined.length - MAX_CAPTURED_OUTPUT_CHARS )
		: combined;
}

// Makes a PHP child a process-group leader on POSIX so its subtree can be signalled via the
// negative PID. On Windows we reap with `taskkill /T` instead, so a new group isn't needed.
export const DETACH_FOR_GROUP_KILL = process.platform !== 'win32';

// Every PHP process spawned through `spawnPhpProcess` that hasn't exited, so shutdown can reap
// in-flight children (mid-startup workers, install/blueprint subprocesses) callers don't track.
const livePhpProcesses = new Set< ChildProcess >();

export type BasePhpOptions = {
	autoPrependFile?: string;
	detached?: boolean;
	disallowRiskyFunctions?: boolean;
	env?: NodeJS.ProcessEnv;
	enableXdebug?: boolean;
	onlyPathsThatPhpCanAccess?: string[];
	phpVersion: NativePhpSupportedVersion;
	siteFolder?: string;
	signal?: AbortSignal;
};
type SpawnPhpProcessOptions = BasePhpOptions & {
	mode?: 'pipe' | 'no-pipe';
};
type RunPhpCommandOptions = BasePhpOptions & {
	mode?: 'pipe' | 'no-pipe' | 'capture';
};

export function spawnPhpProcess(
	args: string[],
	{
		phpVersion,
		siteFolder,
		signal,
		env,
		mode = 'pipe',
		detached = false,
		enableXdebug = false,
		onlyPathsThatPhpCanAccess = [],
		disallowRiskyFunctions = false,
		autoPrependFile,
	}: SpawnPhpProcessOptions
): ChildProcess {
	const defaultArgs = getDefaultPhpArgs( phpVersion, {
		openBasedir: onlyPathsThatPhpCanAccess,
		disallowRiskyFunctions,
		enableXdebug,
		autoPrependFile,
	} );
	const phpArgs = [ ...defaultArgs, ...args ];
	const phpScriptProcess = spawn( getPhpBinaryPath( phpVersion ), phpArgs, {
		cwd: siteFolder,
		env: env ? { ...process.env, ...env } : process.env,
		stdio: [ 'ignore', 'pipe', 'pipe' ],
		signal,
		detached,
	} );

	// Track from the instant of spawn so shutdown can reap this child even before callers
	// store it in their own state. Deregister on exit to keep the set live.
	livePhpProcesses.add( phpScriptProcess );
	phpScriptProcess.once( 'exit', () => livePhpProcesses.delete( phpScriptProcess ) );

	if ( mode === 'pipe' ) {
		phpScriptProcess.stdout?.pipe( process.stdout, { end: false } );
		phpScriptProcess.stderr?.pipe( process.stderr, { end: false } );
	}

	return phpScriptProcess;
}

// Force-kill every tracked PHP process so none outlives the wrapper. Tree-kills because on Windows
// TerminateProcess doesn't cascade — a worker's subprocess would survive and keep DLLs locked.
export function killAllLivePhpProcesses(): void {
	for ( const child of livePhpProcesses ) {
		try {
			// Detach the unexpected-exit listener so the imminent kill is not logged as a crash.
			child.removeAllListeners( 'exit' );
			if ( child.exitCode === null && child.signalCode === null ) {
				killPhpProcessTree( child, 'SIGKILL' );
			}
		} catch {
			// Best effort - nothing useful to do if this fails.
		}
	}
	livePhpProcesses.clear();
}

// Terminate a PHP child and its descendants: `taskkill /T` on Windows (TerminateProcess doesn't
// cascade), or the process group on POSIX (requires `DETACH_FOR_GROUP_KILL`), falling back to the
// lone child.
export function killPhpProcessTree(
	child: ChildProcess,
	signal: NodeJS.Signals = 'SIGKILL'
): void {
	const pid = child.pid;
	if ( ! pid ) {
		return;
	}

	if ( process.platform === 'win32' ) {
		// Bounded so a hung taskkill can't stall the caller's event loop indefinitely (which would
		// hang shutdown). `signal`/`error` on the result means it was cut off before finishing —
		// log it, since that's the smoking gun for a process tree that won't die.
		const result = spawnSync( 'taskkill', [ '/F', '/T', '/PID', String( pid ) ], {
			windowsHide: true,
			stdio: 'ignore',
			timeout: 2_000,
		} );
		if ( result.error || result.signal ) {
			console.error(
				`[PHP] taskkill for pid ${ pid } did not complete (signal: ${ result.signal }, error: ${ result.error?.message })`
			);
		}
		return;
	}

	try {
		process.kill( -pid, signal );
	} catch {
		try {
			child.kill( signal );
		} catch {
			// Already gone.
		}
	}
}

// On SIGINT/SIGTERM, tears down the PHP child's tree and exits 128+signal so php.exe and its
// grandchildren don't outlive the command. Returns a disposer to remove the handlers once the
// command settles. (SIGKILL can't be caught — Studio's quit handler tree-kills for that.)
export function reapPhpTreeOnInterrupt( child: ChildProcess ): () => void {
	const handleInterrupt = ( signal: NodeJS.Signals ) => {
		// Forward the signal to the group so php shuts down like it would on a terminal Ctrl+C,
		// rather than being hard-killed. (Moot on Windows — `taskkill /F` is the only option.)
		killPhpProcessTree( child, signal );
		process.exit( 128 + ( os.constants.signals[ signal ] ?? 0 ) );
	};
	const onSigint = () => handleInterrupt( 'SIGINT' );
	const onSigterm = () => handleInterrupt( 'SIGTERM' );

	process.on( 'SIGINT', onSigint );
	process.on( 'SIGTERM', onSigterm );

	return () => {
		process.off( 'SIGINT', onSigint );
		process.off( 'SIGTERM', onSigterm );
	};
}

export async function runPhpCommand(
	args: string[],
	options: RunPhpCommandOptions
): Promise< { stdout: string; stderr: string } > {
	return await new Promise< { stdout: string; stderr: string } >( ( resolve, reject ) => {
		const phpScriptProcess = spawnPhpProcess( args, {
			...options,
			mode: options.mode === 'capture' ? 'no-pipe' : options.mode,
		} );
		const reportActivity = () => process.send?.( { topic: 'activity' } );

		// `capture` callers parse the whole stdout; other modes keep a tail only to explain a failure.
		const capturing = options.mode === 'capture';
		let stdout = '';
		phpScriptProcess.stdout?.on( 'data', ( chunk ) => {
			reportActivity();
			stdout = capturing ? stdout + chunk.toString() : appendBounded( stdout, chunk.toString() );
		} );

		let stderr = '';
		phpScriptProcess.stderr?.on( 'data', ( chunk ) => {
			reportActivity();
			stderr = capturing ? stderr + chunk.toString() : appendBounded( stderr, chunk.toString() );
		} );

		phpScriptProcess.once( 'error', ( error: Error ) => {
			reject( error );
		} );
		phpScriptProcess.once( 'close', ( code ) => {
			if ( code === 0 ) {
				resolve( { stdout, stderr } );
				return;
			}

			reject( new PhpCommandError( `PHP command failed (code: ${ code })`, code, stdout, stderr ) );
		} );
	} );
}

export async function waitForChildSpawn(
	child: ChildProcess,
	signal?: AbortSignal
): Promise< void > {
	await new Promise< void >( ( resolve, reject ) => {
		child.once( 'spawn', () => {
			resolve();
		} );
		child.once( 'error', ( error: Error ) => {
			reject( error );
		} );
		signal?.addEventListener( 'abort', () => {
			reject( new DOMException( 'Aborted', 'AbortError' ) );
		} );
	} );
}

export async function stopPhpChild(
	child: ChildProcess,
	timeoutMs: number,
	errorToConsole: ErrorLogger
): Promise< void > {
	child.removeAllListeners( 'exit' );
	if ( child.exitCode !== null || child.signalCode !== null ) {
		return;
	}

	await new Promise< void >( ( resolve ) => {
		let settled = false;
		const finish = () => {
			if ( settled ) {
				return;
			}
			settled = true;
			child.off( 'exit', finish );
			resolve();
		};

		// Resolve on 'exit', not 'close': a descendant that inherited the stdio pipes can hold them
		// open after the child dies, so 'close' may never fire and would hang the stop indefinitely.
		child.once( 'exit', finish );

		// Tree-kill so the child's subprocesses die too (Windows TerminateProcess doesn't cascade);
		// otherwise they keep DLLs locked and hold the stdio pipes open.
		killPhpProcessTree( child, 'SIGTERM' );

		setTimeout( () => {
			if ( settled ) {
				return;
			}
			errorToConsole( 'PHP child did not exit in time; force-killing its process tree' );
			killPhpProcessTree( child, 'SIGKILL' );
			// Backstop: resolve even if 'exit' is somehow delayed, so the stop can never hang.
			setTimeout( finish, 1000 );
		}, timeoutMs );
	} );
}
