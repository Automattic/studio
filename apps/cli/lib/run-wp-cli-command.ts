import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
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
import { validateNativePhpVersion } from '@studio/common/lib/php-binary-metadata';
import { LatestSupportedPHPVersion } from '@studio/common/types/php-versions';
import { __ } from '@wordpress/i18n';
import { setupPlatformLevelMuPlugins } from '@wp-playground/wordpress';
import {
	getPhpBinaryPath,
	getSqliteCommandPath,
	getStaticSiteImporterPluginPath,
	getWpCliPharPath,
} from 'cli/lib/dependency-management/paths';
import { validatePhpVersion } from 'cli/lib/utils';
import type { SiteData } from 'cli/lib/cli-config/core';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

const processIdAllocator = new ProcessIdAllocator();
const PLAYGROUND_INTERNAL_SHARED_FOLDER = '/internal/shared';

/**
 * Runtime-agnostic WP-CLI invocation result. Both the native PHP runtime and
 * the Playground runtime produce instances of this class, so callers stay
 * decoupled from Playground's `StreamedPHPResponse`.
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
	const phpVersion = validateNativePhpVersion( options.phpVersion ?? DEFAULT_PHP_VERSION );
	await writeStudioMuPluginsForNativePhpRuntime(
		site.path,
		site.isWpAutoUpdating,
		getStaticSiteImporterPluginPath()
	);
	const child = spawn(
		getPhpBinaryPath( phpVersion ),
		[ getWpCliPharPath(), `--path=${ site.path }`, ...nativeArgs ],
		{
			cwd: site.path,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		}
	);

	await ensureChildSpawned( child );

	const exitCode = new Promise< number >( ( resolve, reject ) => {
		child.once( 'error', ( error: Error ) => reject( error ) );
		child.once( 'exit', ( code ) => resolve( code ?? 1 ) );
	} );

	return {
		response: new WpCliResponse( child.stdout, child.stderr, exitCode ),
		[ Symbol.dispose ]() {
			if ( child.exitCode === null && child.signalCode === null && ! child.killed ) {
				child.kill( 'SIGKILL' );
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
	const siteFolder = site.path;

	if ( site.runtime === 'native-php' ) {
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
			allow_url_fopen: 1,
		} );

		await php.setSpawnHandler( createNoopSpawnHandler() );

		await cleanupLegacyMuPlugins( siteFolder );

		// Mount mu-plugins
		const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( {
			isWpAutoUpdating: false,
			staticSiteImporterPluginPath: getStaticSiteImporterPluginPath(),
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

async function runNativeGlobalWpCliCommand( args: string[] ): Promise< DisposableWpCliResponse > {
	const phpVersion = validateNativePhpVersion( DEFAULT_PHP_VERSION );
	const child = spawn( getPhpBinaryPath( phpVersion ), [ getWpCliPharPath(), ...args ], {
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );

	await ensureChildSpawned( child );

	const exitCode = new Promise< number >( ( resolve, reject ) => {
		child.once( 'error', ( error: Error ) => reject( error ) );
		child.once( 'exit', ( code ) => resolve( code ?? 1 ) );
	} );

	return {
		response: new WpCliResponse( child.stdout, child.stderr, exitCode ),
		[ Symbol.dispose ]() {
			if ( child.exitCode === null && child.signalCode === null && ! child.killed ) {
				child.kill( 'SIGKILL' );
			}
		},
	};
}

type RunGlobalWpCliCommandOptions = {
	runtime?: 'wasm' | 'native-php';
};

/**
 * Run a global WP-CLI command without requiring a site.
 * Useful for commands like --version that don't need a WordPress installation.
 */
export async function runGlobalWpCliCommand(
	args: string[],
	options: RunGlobalWpCliCommandOptions = {}
): Promise< DisposableWpCliResponse > {
	if ( options.runtime === 'native-php' ) {
		return runNativeGlobalWpCliCommand( args );
	}

	const id = await loadNodeRuntime( LatestSupportedPHPVersion, {
		followSymlinks: true,
		withRedis: false,
		withMemcached: false,
		emscriptenOptions: {
			processId: processIdAllocator.claim(),
		},
	} );
	const php = new PHP( id );

	try {
		await php.setSapiName( 'cli' );

		// Setup SSL certificates
		php.writeFile( '/tmp/ca-bundle.crt', rootCertificates.join( '\n' ) );
		await setPhpIniEntries( php, {
			'openssl.cafile': '/tmp/ca-bundle.crt',
			allow_url_fopen: 1,
		} );

		await php.setSpawnHandler( createNoopSpawnHandler() );

		await php.mount( '/tmp/wp-cli.phar', createNodeFsMountHandler( getWpCliPharPath() ) );

		const streamedResponse = await php.cli( [ 'php', '/tmp/wp-cli.phar', ...args ] );

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
