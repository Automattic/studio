import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { buffer, text } from 'node:stream/consumers';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { writeStudioMuPluginsForNativePhpRuntime } from '@studio/common/lib/mu-plugins';
import { resolveSupportedPhpVersion } from '@studio/common/lib/php-binary-metadata';
import {
	getPhpBinaryPath,
	getSqliteCommandPath,
	getWpCliPharPath,
} from 'cli/lib/dependency-management/paths';
import { ensurePhpBinaryAvailable } from './dependency-management/php-binary';
import { getDefaultPhpArgs } from './native-php/config';
import {
	DETACH_FOR_GROUP_KILL,
	getPhpChildEnv,
	killPhpProcessTree,
	reapPhpTreeOnInterrupt,
} from './native-php/php-process';
import { loadImportedRuntimeStartOptionsNative } from './pull/runtime-start-options';
import { getWpCliPhpIniArgs } from './wp-cli-php-ini';
import type { SupportedPHPVersion } from '@studio/common/types/php-versions';
import type { SiteData } from 'cli/lib/cli-config/core';

const OUTPUT_TAIL_BYTES = 1024 * 1024;

/**
 * WP-CLI invocation result.
 *
 * `stdout`/`stderr` are always in-memory streams; live output retains only a
 * bounded tail. The text getters are safe to read in any order relative to
 * `exitCode`.
 *
 * The text getters consume the same underlying stream as `stdout`/`stderr` —
 * use one or the other, not both.
 */
export class WpCliResponse {
	readonly stdout: Readable;
	readonly stderr: Readable;
	readonly exitCode: Promise< number >;
	#stdoutText?: Promise< string >;
	#stderrText?: Promise< string >;

	constructor( stdout: Readable, stderr: Readable, exitCode: Promise< number > ) {
		this.stdout = stdout;
		this.stderr = stderr;
		this.exitCode = exitCode;
	}

	get stdoutText(): Promise< string > {
		this.#stdoutText ??= text( this.stdout );
		return this.#stdoutText;
	}

	get stderrText(): Promise< string > {
		this.#stderrText ??= text( this.stderr );
		return this.#stderrText;
	}
}

/**
 * Eagerly drain a child process's OS-pipe `stdout`/`stderr`, optionally writing
 * each chunk to the terminal, while retaining only its final bounded tail.
 *
 * Once the OS pipe's buffer fills up and nothing is reading the other end, the
 * child process can't write any more and stalls — so a caller that awaits
 * `exitCode` before reading the output would deadlock: the process can't exit
 * until we read, and we don't read until it exits. Draining now keeps the pipe
 * flowing no matter when, or whether, a consumer reads.
 */
export function teeToBoundedTail(
	source: Readable,
	destination?: Writable,
	onOutput?: () => void
): Readable {
	const sink = new PassThrough();
	let tail = Buffer.alloc( 0 );
	let outputStarted = false;
	let paused = false;

	const cleanupDestination = () => {
		destination?.off( 'drain', onDrain );
		destination?.off( 'error', onDestinationError );
	};
	const finish = () => {
		cleanupDestination();
		sink.end( tail );
	};
	const fail = ( error: Error ) => {
		cleanupDestination();
		source.destroy( error );
		sink.destroy( error );
	};
	const onDrain = () => {
		if ( paused ) {
			paused = false;
			source.resume();
		}
	};
	const onDestinationError = ( error: Error ) => fail( error );

	// Flow immediately so the child cannot block on a full OS pipe. One MiB is
	// enough for SSI's bounded terminal receipt while keeping arbitrary command
	// output out of memory.
	source.on( 'data', ( chunk: Buffer | string ) => {
		const data = Buffer.isBuffer( chunk ) ? chunk : Buffer.from( chunk );
		tail = Buffer.concat( [ tail, data ] ).subarray( -OUTPUT_TAIL_BYTES );
		if ( ! outputStarted ) {
			outputStarted = true;
			onOutput?.();
		}
		try {
			if ( destination && ! destination.write( data ) ) {
				paused = true;
				source.pause();
			}
		} catch ( error ) {
			fail( error instanceof Error ? error : new Error( String( error ) ) );
		}
	} );
	source.once( 'end', finish );
	source.once( 'error', ( error ) => {
		cleanupDestination();
		sink.destroy( error );
	} );
	destination?.on( 'drain', onDrain );
	destination?.on( 'error', onDestinationError );

	// `sink` may go unread (a caller may only await `exitCode`), so swallow the
	// error to avoid an uncaught exception; a consumer still sees it via its read.
	sink.on( 'error', () => {} );

	return sink;
}

function drainToMemory( source: Readable ): Readable {
	const sink = new PassThrough();
	buffer( source )
		.then( ( data ) => sink.end( data ) )
		.catch( ( error ) => sink.destroy( error ) );
	sink.on( 'error', () => {} );
	return sink;
}

export type RunWpCliCommandOptions = {
	phpVersion?: SupportedPHPVersion;
	requireSqliteCliCommand?: boolean;
	siteUrl?: string;
	stdio?: 'inherit' | 'pipe';
	/** Stream native child output to the terminal while retaining a bounded failure tail. */
	liveOutput?: boolean;
	/** Runs once immediately before the first native live output is written. */
	onLiveOutput?: () => void;
};

function applyWpCliCommandOptions( args: string[], options: RunWpCliCommandOptions ): string[] {
	let normalizedArgs = args.slice();

	if ( options.requireSqliteCliCommand ) {
		const requireArg = `--require=${ path.join( getSqliteCommandPath(), 'command.php' ) }`;

		if ( ! normalizedArgs.includes( requireArg ) ) {
			normalizedArgs = [ ...normalizedArgs, requireArg ];
		}
	}

	return normalizedArgs;
}

async function ensureChildSpawned( child: ChildProcess ): Promise< void > {
	await new Promise< void >( ( resolve, reject ) => {
		const onSpawn = () => {
			child.off( 'error', onError );
			resolve();
		};
		const onError = ( error: Error ) => {
			child.off( 'spawn', onSpawn );
			reject( error );
		};

		child.once( 'spawn', onSpawn );
		child.once( 'error', onError );
	} );
}

type DisposableWpCliResponse = Disposable & {
	response: WpCliResponse;
};

type DisposableExitCode = Disposable & {
	exitCode: Promise< number >;
};

async function runNativeWpCliCommand(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions & { stdio: 'inherit' }
): Promise< DisposableExitCode >;
async function runNativeWpCliCommand(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions
): Promise< DisposableWpCliResponse >;
async function runNativeWpCliCommand(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions = {}
): Promise< DisposableWpCliResponse | DisposableExitCode > {
	const phpVersion = resolveSupportedPhpVersion( options.phpVersion ?? DEFAULT_PHP_VERSION );
	await ensurePhpBinaryAvailable( phpVersion );
	await writeStudioMuPluginsForNativePhpRuntime( site.path, site.isWpAutoUpdating );

	// Reprint-pulled sites wire SQLite through runtime.php (loaded as auto_prepend_file),
	// so load it here too. No-op for normal sites (helper returns undefined).
	const autoPrependFile = options.requireSqliteCliCommand
		? undefined
		: loadImportedRuntimeStartOptionsNative( site )?.autoPrependFile;
	// Don't apply open_basedir or disable_functions to the WP-CLI process
	const defaultArgs = getDefaultPhpArgs( phpVersion, { autoPrependFile } );
	const nativeArgs = applyWpCliCommandOptions( args, options );
	const child = spawn(
		getPhpBinaryPath( phpVersion ),
		[
			...defaultArgs,
			...getWpCliPhpIniArgs(),
			getWpCliPharPath(),
			`--path=${ site.path }`,
			...nativeArgs,
		],
		{
			cwd: site.path,
			env: getPhpChildEnv(),
			stdio: options.stdio === 'inherit' ? 'inherit' : [ 'ignore', 'pipe', 'pipe' ],
			detached: DETACH_FOR_GROUP_KILL,
		}
	);

	await ensureChildSpawned( child );
	const removeReaper = reapPhpTreeOnInterrupt( child );

	const exitCode = new Promise< number >( ( resolve, reject ) => {
		child.once( 'error', ( error: Error ) => reject( error ) );
		child.once( 'exit', ( code ) => resolve( code ?? 1 ) );
	} );

	const dispose = () => {
		removeReaper();
		// Tree-kill so any subprocess WP-CLI spawned dies with it, not just the php.exe itself.
		if ( child.exitCode === null && child.signalCode === null && ! child.killed ) {
			killPhpProcessTree( child, 'SIGKILL' );
		}
	};

	if ( options.stdio === 'inherit' ) {
		return {
			exitCode: exitCode,
			[ Symbol.dispose ]: dispose,
		};
	}
	let liveOutputStarted = false;
	const onLiveOutput = () => {
		if ( ! liveOutputStarted ) {
			liveOutputStarted = true;
			options.onLiveOutput?.();
		}
	};
	return {
		response: new WpCliResponse(
			// Non-null: the 'pipe' stdio mode always provides stdout/stderr streams.
			options.liveOutput
				? teeToBoundedTail( child.stdout!, process.stdout, onLiveOutput )
				: drainToMemory( child.stdout! ),
			options.liveOutput
				? teeToBoundedTail( child.stderr!, process.stderr, onLiveOutput )
				: drainToMemory( child.stderr! ),
			exitCode
		),
		[ Symbol.dispose ]: dispose,
	};
}

// Passing `stdio: 'inherit'` connects the child to the parent's terminal fds for
// piped/interactive stdin, live streaming output and TTY detection (colors), and
// returns only the exit code.
export async function runWpCliCommand(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions & { stdio: 'inherit' }
): Promise< DisposableExitCode >;
export async function runWpCliCommand(
	site: SiteData,
	args: string[],
	options?: RunWpCliCommandOptions
): Promise< DisposableWpCliResponse >;
export async function runWpCliCommand(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions = {}
): Promise< DisposableWpCliResponse | DisposableExitCode > {
	return runNativeWpCliCommand( site, args, options );
}
