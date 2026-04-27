import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { Readable } from 'node:stream';
import { rootCertificates } from 'node:tls';
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';
import {
	StreamedPHPResponse,
	SupportedPHPVersion,
	PHP,
	setPhpIniEntries,
	ProcessIdAllocator,
} from '@php-wasm/universal';
import { createSpawnHandler } from '@php-wasm/util';
import { IS_JSPI_AVAILABLE } from '@studio/common/lib/jspi';
import { cleanupLegacyMuPlugins, getMuPlugins } from '@studio/common/lib/mu-plugins';
import { LatestSupportedPHPVersion } from '@studio/common/types/php-versions';
import { __ } from '@wordpress/i18n';
import { setupPlatformLevelMuPlugins } from '@wp-playground/wordpress';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import {
	getPhpBinaryPath,
	getSqliteCommandPath,
	getWpCliPharPath,
} from 'cli/lib/dependency-management/paths';

const processIdAllocator = new ProcessIdAllocator();
const PLAYGROUND_INTERNAL_SHARED_FOLDER = '/internal/shared';

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

function createClosedReadableStream(): ReadableStream< Uint8Array > {
	return new ReadableStream( {
		start( controller ) {
			controller.close();
		},
	} );
}

function toWebReadableStream(
	stream: NodeJS.ReadableStream | null | undefined
): ReadableStream< Uint8Array > {
	if ( ! stream ) {
		return createClosedReadableStream();
	}

	return Readable.toWeb( stream as Readable ) as ReadableStream< Uint8Array >;
}

type RunWpCliCommandOptions = {
	siteUrl?: string;
	requireSqliteCliCommand?: boolean;
};

type DisposableWpCliResponse = Disposable & {
	response: StreamedPHPResponse;
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
	siteFolder: string,
	args: string[],
	options: RunWpCliCommandOptions = {}
): Promise< DisposableWpCliResponse > {
	const nativeArgs = applyWpCliCommandOptions( 'native', args, options );
	const child = spawn(
		getPhpBinaryPath(),
		[ getWpCliPharPath(), `--path=${ siteFolder }`, ...nativeArgs ],
		{
			cwd: siteFolder,
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		}
	);

	await ensureChildSpawned( child );

	const exitCode = new Promise< number >( ( resolve, reject ) => {
		child.once( 'error', ( error: Error ) => reject( error ) );
		child.once( 'exit', ( code ) => resolve( code ?? 1 ) );
	} );

	return {
		response: new StreamedPHPResponse(
			createClosedReadableStream(),
			toWebReadableStream( child.stdout ),
			toWebReadableStream( child.stderr ),
			exitCode
		),
		[ Symbol.dispose ]() {
			if ( child.exitCode === null && child.signalCode === null && ! child.killed ) {
				child.kill( 'SIGKILL' );
			}
		},
	};
}

// Run a WP-CLI command in a PHP-WASM instance. This function can be used even if the targeted
// Studio site is already running, but it is typically faster to use the `sendWpCliCommand`
// function in that case.
export async function runWpCliCommand(
	siteFolder: string,
	phpVersion: SupportedPHPVersion,
	args: string[],
	options: RunWpCliCommandOptions = {}
): Promise< DisposableWpCliResponse > {
	try {
		const site = await getSiteByFolder( siteFolder );
		if ( site.runtime === 'native-php' ) {
			return runNativeWpCliCommand( siteFolder, args, options );
		}
	} catch {
		// If the site can't be resolved from config, keep the previous behavior and
		// continue with the PHP-WASM execution path.
	}

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
		const response = await php.cli( [
			'php',
			'/tmp/wp-cli.phar',
			'--path=/wordpress',
			...wasmArgs,
		] );

		return {
			response,
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
	const child = spawn( getPhpBinaryPath(), [ getWpCliPharPath(), ...args ], {
		stdio: [ 'ignore', 'pipe', 'pipe' ],
	} );

	await ensureChildSpawned( child );

	const exitCode = new Promise< number >( ( resolve, reject ) => {
		child.once( 'error', ( error: Error ) => reject( error ) );
		child.once( 'exit', ( code ) => resolve( code ?? 1 ) );
	} );

	return {
		response: new StreamedPHPResponse(
			createClosedReadableStream(),
			toWebReadableStream( child.stdout ),
			toWebReadableStream( child.stderr ),
			exitCode
		),
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

		const response = await php.cli( [ 'php', '/tmp/wp-cli.phar', ...args ] );

		return {
			response,
			[ Symbol.dispose ]() {
				php.exit();
			},
		};
	} catch ( error ) {
		php.exit();
		throw new Error( __( 'An error occurred while running the WP-CLI command.' ) );
	}
}
