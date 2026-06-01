import { ChildProcess, spawn } from 'node:child_process';
import { getPhpBinaryPath } from 'cli/lib/dependency-management/paths';
import { getDefaultPhpArgs } from 'cli/lib/native-php';
import type { NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';

type ErrorLogger = ( ...args: Parameters< typeof console.error > ) => void;

// Every PHP process spawned through `spawnPhpProcess` that hasn't exited yet — long-lived workers
// and short-lived one-off commands (WordPress install, blueprint application) alike. Tracked from
// the instant of spawn so involuntary shutdown can reap in-flight children that callers haven't
// yet stored in their own state. Without this, a worker spawned mid-startup or a running blueprint
// subprocess is orphaned when the wrapper exits and, on Windows, survives to keep php-bin DLLs locked.
const livePhpProcesses = new Set< ChildProcess >();

export type SpawnPhpProcessOptions = {
	detached?: boolean;
	disallowRiskyFunctions?: boolean;
	env?: NodeJS.ProcessEnv;
	mode?: 'pipe' | 'capture-stdout';
	enableXdebug?: boolean;
	onlyPathsThatPhpCanAccess?: string[];
	phpVersion: NativePhpSupportedVersion;
	siteFolder?: string;
	signal?: AbortSignal;
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
	}: SpawnPhpProcessOptions
): ChildProcess {
	const defaultArgs = getDefaultPhpArgs(
		phpVersion,
		onlyPathsThatPhpCanAccess,
		disallowRiskyFunctions,
		enableXdebug
	);
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
	}

	if ( mode === 'pipe' || mode === 'capture-stdout' ) {
		phpScriptProcess.stderr?.pipe( process.stderr, { end: false } );
	}

	return phpScriptProcess;
}

// Force-kill every PHP process spawned through `spawnPhpProcess` that hasn't exited. Used on
// involuntary shutdown to guarantee no PHP child outlives the wrapper — including workers still
// mid-startup and in-flight command subprocesses that callers don't track individually.
export function killAllLivePhpProcesses(): void {
	for ( const child of livePhpProcesses ) {
		try {
			// Detach the unexpected-exit listener so the imminent SIGKILL is not logged as a crash.
			child.removeAllListeners( 'exit' );
			if ( child.exitCode === null && child.signalCode === null ) {
				child.kill( 'SIGKILL' );
			}
		} catch {
			// Best effort - nothing useful to do if this fails.
		}
	}
	livePhpProcesses.clear();
}

type RunPhpCommandOptions = SpawnPhpProcessOptions;

export async function runPhpCommand(
	args: string[],
	options: RunPhpCommandOptions
): Promise< { stdout: string } > {
	return await new Promise< { stdout: string } >( ( resolve, reject ) => {
		const phpScriptProcess = spawnPhpProcess( args, options );

		let stdout = '';
		const reportActivity = () => process.send?.( { topic: 'activity' } );
		phpScriptProcess.stdout?.on( 'data', ( chunk ) => {
			reportActivity();
			if ( options.mode === 'capture-stdout' ) {
				stdout += chunk.toString();
			}
		} );
		phpScriptProcess.stderr?.on( 'data', reportActivity );

		phpScriptProcess.once( 'error', ( error: Error ) => {
			reject( error );
		} );
		phpScriptProcess.once( 'close', ( code ) => {
			if ( code === 0 ) {
				resolve( { stdout } );
				return;
			}

			reject( new Error( `PHP command failed (code: ${ code })` ) );
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
		const forceKillTimeout = setTimeout( () => {
			errorToConsole( 'PHP child did not exit in time; sending SIGKILL' );
			if ( child.exitCode === null && child.signalCode === null ) {
				child.kill( 'SIGKILL' );
			}
		}, timeoutMs );

		child.once( 'close', () => {
			clearTimeout( forceKillTimeout );
			resolve();
		} );

		child.kill( 'SIGTERM' );
	} );
}

export function markPhpChildAsCritical(
	child: ChildProcess,
	label: string,
	errorToConsole: ErrorLogger
): void {
	child.once( 'exit', ( code, signalName ) => {
		errorToConsole( `${ label } exited unexpectedly (code: ${ code }, signal: ${ signalName })` );
		process.exit( code ?? 1 );
	} );
}
