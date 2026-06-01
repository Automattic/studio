import { ChildProcess, spawn } from 'node:child_process';
import { getPhpBinaryPath } from 'cli/lib/dependency-management/paths';
import { getDefaultPhpArgs } from 'cli/lib/native-php';
import type { NativePhpSupportedVersion } from '@studio/common/lib/php-binary-metadata';

type ErrorLogger = ( ...args: Parameters< typeof console.error > ) => void;

export type SpawnPhpProcessOptions = {
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
	} );

	if ( mode === 'pipe' ) {
		phpScriptProcess.stdout?.pipe( process.stdout, { end: false } );
	}

	if ( mode === 'pipe' || mode === 'capture-stdout' ) {
		phpScriptProcess.stderr?.pipe( process.stderr, { end: false } );
	}

	return phpScriptProcess;
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
