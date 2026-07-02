import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { buffer, text } from 'node:stream/consumers';
import { rootCertificates } from 'node:tls';
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';
import {
	SupportedPHPVersion,
	PHP,
	setPhpIniEntries,
	ProcessIdAllocator,
} from '@php-wasm/universal';
import { createSpawnHandler } from '@php-wasm/util';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { isMysqlSite } from '@studio/common/lib/database-engine';
import { IS_JSPI_AVAILABLE } from '@studio/common/lib/jspi';
import {
	cleanupLegacyMuPlugins,
	getMuPlugins,
	writeStudioMuPluginsForNativePhpRuntime,
} from '@studio/common/lib/mu-plugins';
import { resolveNativePhpVersion } from '@studio/common/lib/php-binary-metadata';
import {
	getSiteRuntime,
	SITE_RUNTIME_NATIVE_PHP,
	SITE_RUNTIME_PLAYGROUND,
} from '@studio/common/lib/site-runtime';
import { __ } from '@wordpress/i18n';
import { setupPlatformLevelMuPlugins } from '@wp-playground/wordpress';
import {
	getPhpBinaryPath,
	getSqliteCommandPath,
	getWpCliPharPath,
} from 'cli/lib/dependency-management/paths';
import { validatePhpVersion } from 'cli/lib/utils';
import { ensurePhpBinaryAvailable } from './dependency-management/php-binary';
import { ensureMysqlServerRunning, type ManagedMysqlServer } from './mysql/mysql-process';
import { getDefaultPhpArgs } from './native-php/config';
import {
	DETACH_FOR_GROUP_KILL,
	killPhpProcessTree,
	reapPhpTreeOnInterrupt,
} from './native-php/php-process';
import { loadImportedRuntimeStartOptionsNative } from './pull/runtime-start-options';
import { isServerRunning, sendWpCliCommand } from './wordpress-server-manager';
import { stripLeadingShebang } from './wp-cli-shebang';
import type { SiteData } from 'cli/lib/cli-config/core';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

const processIdAllocator = new ProcessIdAllocator();
const PLAYGROUND_INTERNAL_SHARED_FOLDER = '/internal/shared';

/**
 * Runtime-agnostic WP-CLI invocation result. Both the native PHP runtime and
 * the Playground runtime produce instances of this class, so callers stay
 * decoupled from Playground's `StreamedPHPResponse`.
 *
 * `stdout`/`stderr` are always in-memory streams (Playground produces them in
 * memory; the native runtime pre-drains its OS pipes via `drainToMemory`), so
 * the text getters are safe to read in any order relative to `exitCode`.
 *
 * For Playground-produced stdout the leading shebang line is already stripped at
 * construction (see `stripLeadingShebang`), so consumers get clean output.
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
 * Eagerly drain a child process's OS-pipe `stdout`/`stderr` into an in-memory
 * stream.
 *
 * Once the OS pipe's buffer fills up and nothing is reading the other end, the
 * child process can't write any more and stalls — so a caller that awaits
 * `exitCode` before reading the output would deadlock: the process can't exit
 * until we read, and we don't read until it exits. Draining now keeps the pipe
 * flowing no matter when, or whether, a consumer reads.
 */
function drainToMemory( source: Readable ): Readable {
	const sink = new PassThrough();

	// `buffer()` reads `source` right away; replay it once drained, or forward
	// a read error to whoever consumes `sink`.
	buffer( source )
		.then( ( data ) => sink.end( data ) )
		.catch( ( error ) => sink.destroy( error ) );

	// `sink` may go unread (a caller may only await `exitCode`), so swallow the
	// error to avoid an uncaught exception; a consumer still sees it via its read.
	sink.on( 'error', () => {} );

	return sink;
}

type RunWpCliCommandOptions = {
	phpVersion?: SupportedPHPVersion;
	requireSqliteCliCommand?: boolean;
	siteUrl?: string;
	stdio?: 'inherit' | 'pipe';
};

const WASM_SQLITE_COMMAND_PATH = '/tmp/sqlite-command/command.php';

function applyWpCliCommandOptions(
	runtime: 'wasm' | 'native',
	args: string[],
	options: RunWpCliCommandOptions
): string[] {
	let normalizedArgs = args.slice();

	if ( options.requireSqliteCliCommand ) {
		const sqliteCommandPath =
			runtime === 'native'
				? path.join( getSqliteCommandPath(), 'command.php' )
				: WASM_SQLITE_COMMAND_PATH;
		const requireArg = `--require=${ sqliteCommandPath }`;

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
	const phpVersion = resolveNativePhpVersion( options.phpVersion ?? DEFAULT_PHP_VERSION );
	await ensurePhpBinaryAvailable( phpVersion );
	await writeStudioMuPluginsForNativePhpRuntime( site.path, site.isWpAutoUpdating, {
		siteHost: site.customDomain,
		sitePort: site.port,
	} );
	let mysqlServer: ManagedMysqlServer | null = null;
	if ( isMysqlSite( site ) ) {
		if ( ! site.mysql ) {
			throw new Error( 'MySQL site is missing database configuration.' );
		}
		mysqlServer = await ensureMysqlServerRunning( site.mysql );
	}

	// Reprint-pulled sites wire SQLite through runtime.php (loaded as auto_prepend_file),
	// so load it here too. No-op for normal sites (helper returns undefined).
	const autoPrependFile = options.requireSqliteCliCommand
		? undefined
		: loadImportedRuntimeStartOptionsNative( site )?.autoPrependFile;
	// Don't apply open_basedir or disable_functions to the WP-CLI process
	const defaultArgs = getDefaultPhpArgs( phpVersion, { autoPrependFile } );
	const nativeArgs = applyWpCliCommandOptions( 'native', args, options );
	const child = spawn(
		getPhpBinaryPath( phpVersion ),
		[ ...defaultArgs, getWpCliPharPath(), `--path=${ site.path }`, ...nativeArgs ],
		{
			cwd: site.path,
			stdio: options.stdio === 'inherit' ? 'inherit' : [ 'ignore', 'pipe', 'pipe' ],
			detached: DETACH_FOR_GROUP_KILL,
		}
	);

	try {
		await ensureChildSpawned( child );
	} catch ( error ) {
		await mysqlServer?.stop().catch( () => undefined );
		throw error;
	}
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
		void mysqlServer?.stop();
	};

	if ( options.stdio === 'inherit' ) {
		return {
			exitCode: exitCode,
			[ Symbol.dispose ]: dispose,
		};
	}

	return {
		response: new WpCliResponse(
			// Non-null: the 'pipe' stdio mode always provides stdout/stderr streams.
			drainToMemory( child.stdout! ),
			drainToMemory( child.stderr! ),
			exitCode
		),
		[ Symbol.dispose ]: dispose,
	};
}

/**
 * Creates a no-op spawn handler that immediately exits with code 1.
 * This allows process spawning functions (proc_open, exec, etc.) to be called
 * without crashing, but they will fail gracefully. WP-CLI detects these failures
 * and falls back to single-threaded mode.
 *
 * The timeout before exit is required by the createSpawnHandler API — PHP needs
 * an event loop tick to set up its stream listeners after proc_open() returns.
 * Without it, the process exits before PHP registers its handlers and
 * createSpawnHandler throws a "exited synchronously" error.
 */
function createNoopSpawnHandler() {
	return createSpawnHandler( async ( args, processApi ) => {
		await new Promise( ( resolve ) => setTimeout( resolve, 1 ) );
		processApi.exit( 1 );
	} );
}

// Run a WP-CLI command with the appropriate PHP runtime. For Playground runtime
// sites, this function will always instantiate a new PHP-WASM instance. This
// strategy works regardless of whether the site is running, but
// `runWpCliCommandWithMessaging` is faster if the site is running.
//
// Passing `stdio: 'inherit'` connects the child to the parent's terminal fds for
// piped/interactive stdin, live streaming output and TTY detection (colors), and
// returns only the exit code. This is native-only — the Playground runtime has no
// way to attach to the terminal, so requesting it for a Playground site throws.
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
	if ( getSiteRuntime( site ) === SITE_RUNTIME_NATIVE_PHP ) {
		return runNativeWpCliCommand( site, args, options );
	}

	if ( options.stdio === 'inherit' ) {
		throw new Error( 'stdio: "inherit" is only supported for the native PHP runtime.' );
	}

	const phpVersion = options.phpVersion ?? validatePhpVersion( site.phpVersion );

	const id = await loadNodeRuntime( phpVersion, {
		followSymlinks: true,
		withRedis: IS_JSPI_AVAILABLE,
		withMemcached: IS_JSPI_AVAILABLE,
		emscriptenOptions: {
			processId: processIdAllocator.claim(),
		},
	} );
	const php = new PHP( id );

	try {
		await php.setSapiName( 'cli' );

		// Fallback for sites where DB_NAME was stripped from wp-config.php.
		// The SQLite driver (v3+) requires a non-empty DB_NAME at runtime.
		php.defineConstant( 'DB_NAME', 'wordpress' );

		php.mkdir( '/wordpress' );
		await php.mount( '/wordpress', createNodeFsMountHandler( site.path ) );
		php.chdir( '/wordpress' );

		// Setup SSL certificates
		php.writeFile( '/tmp/ca-bundle.crt', rootCertificates.join( '\n' ) );
		await setPhpIniEntries( php, {
			'openssl.cafile': '/tmp/ca-bundle.crt',
			'curl.cainfo': '/tmp/ca-bundle.crt',
			allow_url_fopen: 1,
		} );

		await php.setSpawnHandler( createNoopSpawnHandler() );

		await cleanupLegacyMuPlugins( site.path );

		// Mount mu-plugins
		const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( {
			isWpAutoUpdating: false,
		} );
		await php.mount(
			'/internal/studio/mu-plugins',
			createNodeFsMountHandler( studioMuPluginsHostPath )
		);
		await php.mount(
			PLAYGROUND_INTERNAL_SHARED_FOLDER + '/mu-plugins/99-studio-loader.php',
			createNodeFsMountHandler( loaderMuPluginHostPath )
		);
		await php.mount( '/tmp/wp-cli.phar', createNodeFsMountHandler( getWpCliPharPath() ) );
		await php.mount( '/tmp/sqlite-command', createNodeFsMountHandler( getSqliteCommandPath() ) );

		await setupPlatformLevelMuPlugins( php );

		const wasmArgs = applyWpCliCommandOptions( 'wasm', args, options );
		const streamedResponse = await php.cli( [
			'php',
			'/tmp/wp-cli.phar',
			'--path=/wordpress',
			...wasmArgs,
		] );

		return {
			response: new WpCliResponse(
				stripLeadingShebang( Readable.fromWeb( streamedResponse.stdout as WebReadableStream ) ),
				Readable.fromWeb( streamedResponse.stderr as WebReadableStream ),
				streamedResponse.exitCode
			),
			[ Symbol.dispose ]() {
				php.exit();
			},
		};
	} catch ( error ) {
		php.exit();
		throw new Error( __( 'An error occurred while running the WP-CLI command.' ) );
	}
}

// Similarly to `runWpCliCommand`, this function executes a WP-CLI command with
// the appropriate PHP runtime. The difference is that for Playground runtimes,
// this function will check if the server is running and send the WP-CLI command
// over IPC only if it is. This is faster than instantiating a new PHP-WASM.
// Remember that you need to be connected to the process daemon before running
// this function.
export async function runWpCliCommandWithMessaging(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions = {}
): Promise< DisposableWpCliResponse > {
	const useCustomPhpVersion = options.phpVersion && options.phpVersion !== site.phpVersion;

	if ( getSiteRuntime( site ) === SITE_RUNTIME_PLAYGROUND && ! useCustomPhpVersion ) {
		try {
			const runningProcess = await isServerRunning( site.id );
			if ( runningProcess ) {
				const response = await sendWpCliCommand( site.id, args );

				// `Readable.from( [ Buffer ] )` emits all of the contents as one chunk;
				// `stripLeadingShebang` removes the Playground shebang line if present.
				return {
					response: new WpCliResponse(
						stripLeadingShebang( Readable.from( [ Buffer.from( response.stdout ) ] ) ),
						Readable.from( [ Buffer.from( response.stderr ) ] ),
						Promise.resolve( response.exitCode )
					),
					[ Symbol.dispose ]() {
						// Output is already buffered in memory, so there's nothing to tear down.
					},
				};
			}
		} catch ( error ) {
			// The server is running but the command couldn't be sent over IPC (e.g. the
			// process predates WP-CLI messaging support, or messaging failed). Fall back to a
			// fresh PHP-WASM instance below rather than surfacing the error to the caller.
		}
	}

	return runWpCliCommand( site, args, options );
}
