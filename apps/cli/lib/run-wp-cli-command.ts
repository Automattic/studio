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
import { IS_JSPI_AVAILABLE } from '@studio/common/lib/jspi';
import {
	cleanupLegacyMuPlugins,
	getMuPlugins,
	writeStudioMuPluginsForNativePhpRuntime,
} from '@studio/common/lib/mu-plugins';
import { resolveNativePhpVersion } from '@studio/common/lib/php-binary-metadata';
import { getSiteRuntime, SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { __ } from '@wordpress/i18n';
import { setupPlatformLevelMuPlugins } from '@wp-playground/wordpress';
import { getWpPath } from 'cli/lib/cli-config/sites';
import {
	getPhpBinaryPath,
	getSqliteCommandPath,
	getWpCliPharPath,
} from 'cli/lib/dependency-management/paths';
import { validatePhpVersion } from 'cli/lib/utils';
import { getDefaultPhpArgs } from './native-php/config';
import {
	DETACH_FOR_GROUP_KILL,
	killPhpProcessTree,
	reapPhpTreeOnInterrupt,
} from './native-php/php-process';
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
	siteUrl?: string;
	requireSqliteCliCommand?: boolean;
	phpVersion?: SupportedPHPVersion;
};

type DisposableWpCliResponse = Disposable & {
	response: WpCliResponse;
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

async function runNativeWpCliCommand(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions = {}
): Promise< DisposableWpCliResponse > {
	const nativeArgs = applyWpCliCommandOptions( 'native', args, options );
	const phpVersion = resolveNativePhpVersion( options.phpVersion ?? DEFAULT_PHP_VERSION );
	const wpPath = getWpPath( site );
	await writeStudioMuPluginsForNativePhpRuntime( wpPath, site.isWpAutoUpdating );
	// Don't apply open_basedir or disable_functions to the WP-CLI process
	const defaultArgs = getDefaultPhpArgs( phpVersion );
	const child = spawn(
		getPhpBinaryPath( phpVersion ),
		[ ...defaultArgs, getWpCliPharPath(), `--path=${ wpPath }`, ...nativeArgs ],
		{
			cwd: wpPath,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
			detached: DETACH_FOR_GROUP_KILL,
		}
	);

	await ensureChildSpawned( child );
	const removeReaper = reapPhpTreeOnInterrupt( child );

	const exitCode = new Promise< number >( ( resolve, reject ) => {
		child.once( 'error', ( error: Error ) => reject( error ) );
		child.once( 'exit', ( code ) => resolve( code ?? 1 ) );
	} );

	return {
		response: new WpCliResponse(
			drainToMemory( child.stdout ),
			drainToMemory( child.stderr ),
			exitCode
		),
		[ Symbol.dispose ]() {
			removeReaper();
			// Tree-kill so any subprocess WP-CLI spawned dies with it, not just the php.exe itself.
			if ( child.exitCode === null && child.signalCode === null && ! child.killed ) {
				killPhpProcessTree( child, 'SIGKILL' );
			}
		},
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

// Run a WP-CLI command in a PHP-WASM instance. This function can be used even if the targeted
// Studio site is already running, but it is typically faster to use the `sendWpCliCommand`
// function in that case.
export async function runWpCliCommand(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions = {}
): Promise< DisposableWpCliResponse > {
	const siteFolder = getWpPath( site );

	if ( getSiteRuntime( site ) === SITE_RUNTIME_NATIVE_PHP ) {
		return runNativeWpCliCommand( site, args, options );
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
		await php.mount( '/wordpress', createNodeFsMountHandler( siteFolder ) );
		php.chdir( '/wordpress' );

		// Setup SSL certificates
		php.writeFile( '/tmp/ca-bundle.crt', rootCertificates.join( '\n' ) );
		await setPhpIniEntries( php, {
			'openssl.cafile': '/tmp/ca-bundle.crt',
			'curl.cainfo': '/tmp/ca-bundle.crt',
			allow_url_fopen: 1,
		} );

		await php.setSpawnHandler( createNoopSpawnHandler() );

		await cleanupLegacyMuPlugins( siteFolder );

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
				Readable.fromWeb( streamedResponse.stdout as WebReadableStream ),
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
