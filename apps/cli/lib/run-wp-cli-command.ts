import { createRequire } from 'node:module';
import path from 'node:path';
import { rootCertificates } from 'node:tls';
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';
import {
	StreamedPHPResponse,
	SupportedPHPVersion,
	PHP,
	setPhpIniEntries,
	ProcessIdAllocator,
} from '@php-wasm/universal';
import { createSpawnHandler, phpVar } from '@php-wasm/util';
import { IS_JSPI_AVAILABLE } from '@studio/common/lib/jspi';
import { cleanupLegacyMuPlugins, getMuPlugins } from '@studio/common/lib/mu-plugins';
import { LatestSupportedPHPVersion } from '@studio/common/types/php-versions';
import { __ } from '@wordpress/i18n';
import { setupPlatformLevelMuPlugins } from '@wp-playground/wordpress';
import yauzl from 'yauzl';
import { getSqliteCommandPath, getWpCliPharPath } from 'cli/lib/server-files';

const require = createRequire( import.meta.url );

function getSqliteIntegrationZipPath(): string {
	return path.join(
		path.dirname( require.resolve( '@wp-playground/cli/package.json' ) ),
		'sqlite-database-integration.zip'
	);
}

/**
 * Node.js reimplementation of preloadSqliteIntegration from @wp-playground/wordpress.
 * The upstream version uses php.run() internally (via unzipFile) to extract the zip,
 * which corrupts the PHP WASM runtime state for subsequent php.cli() calls. This version
 * extracts the zip in Node.js and writes files directly into the PHP VFS instead.
 */
async function setupSqliteIntegration( php: PHP ): Promise< void > {
	const pluginVfsPath = '/internal/shared/sqlite-database-integration';

	// Extract zip in Node.js and write files directly into the PHP VFS.
	// We use yauzl (already a transitive dependency) instead of php.run()-based
	// extraction to avoid corrupting the PHP WASM runtime state before php.cli().
	const zipPath = getSqliteIntegrationZipPath();
	await new Promise< void >( ( resolve, reject ) => {
		yauzl.open( zipPath, { lazyEntries: true }, ( err, zipfile ) => {
			if ( err || ! zipfile ) {
				return reject( err );
			}
			zipfile.readEntry();
			zipfile.on( 'entry', ( entry: yauzl.Entry ) => {
				// Strip the top-level directory (e.g. plugin-sqlite-database-integration/)
				const relativePath = entry.fileName.replace( /^[^/]+\//, '' );
				if ( ! relativePath || entry.fileName.endsWith( '/' ) ) {
					zipfile.readEntry();
					return;
				}
				const vfsFilePath = `${ pluginVfsPath }/${ relativePath }`;
				const dir = path.posix.dirname( vfsFilePath );
				if ( ! php.isDir( dir ) ) {
					php.mkdir( dir );
				}
				zipfile.openReadStream( entry, ( streamErr, readStream ) => {
					if ( streamErr || ! readStream ) {
						return reject( streamErr );
					}
					const chunks: Buffer[] = [];
					readStream.on( 'data', ( chunk: Buffer ) => chunks.push( chunk ) );
					readStream.on( 'end', () => {
						php.writeFile( vfsFilePath, new Uint8Array( Buffer.concat( chunks ) ) );
						zipfile.readEntry();
					} );
					readStream.on( 'error', reject );
				} );
			} );
			zipfile.on( 'end', resolve );
			zipfile.on( 'error', reject );
		} );
	} );

	// Write SQLITE_MAIN_FILE constant
	php.defineConstant( 'SQLITE_MAIN_FILE', '1' );

	// Generate the mu-plugin and preload files from db.copy (same logic as upstream)
	const dbCopyContent = php
		.readFileAsText( `${ pluginVfsPath }/db.copy` )
		.replace( "'{SQLITE_IMPLEMENTATION_FOLDER_PATH}'", phpVar( pluginVfsPath ) )
		.replace( "'{SQLITE_PLUGIN}'", phpVar( `${ pluginVfsPath }/load.php` ) );

	const dbPhpGuard = `<?php
	// Do not preload this if WordPress comes with a custom db.php file.
	if(file_exists(${ phpVar( '/wordpress/wp-content/db.php' ) })) {
		return;
	}
	?>`;

	const muPluginPath = '/internal/shared/mu-plugins/sqlite-database-integration.php';
	php.writeFile( muPluginPath, dbPhpGuard + dbCopyContent );

	const preloadContent = `<?php
/**
 * Loads the SQLite integration plugin before WordPress is loaded
 * and without creating a drop-in "db.php" file.
 */
class Playground_SQLite_Integration_Loader {
	public function __call($name, $arguments) {
		$this->load_sqlite_integration();
		if($GLOBALS['wpdb'] === $this) {
			throw new Exception('Infinite loop detected in $wpdb – SQLite integration plugin could not be loaded');
		}
		return call_user_func_array(array($GLOBALS['wpdb'], $name), $arguments);
	}
	public function __get($name) {
		$this->load_sqlite_integration();
		if($GLOBALS['wpdb'] === $this) {
			throw new Exception('Infinite loop detected in $wpdb – SQLite integration plugin could not be loaded');
		}
		return $GLOBALS['wpdb']->$name;
	}
	public function __set($name, $value) {
		$this->load_sqlite_integration();
		if($GLOBALS['wpdb'] === $this) {
			throw new Exception('Infinite loop detected in $wpdb – SQLite integration plugin could not be loaded');
		}
		$GLOBALS['wpdb']->$name = $value;
	}
	protected function load_sqlite_integration() {
		require_once ${ phpVar( muPluginPath ) };
	}
}
$GLOBALS['wpdb'] = new Playground_SQLite_Integration_Loader();
`;

	php.writeFile( '/internal/shared/preload/0-sqlite.php', dbPhpGuard + preloadContent );
}

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

export interface RunWpCliCommandOptions {
	siteUrl?: string;
}

interface DisposableWpCliResponse extends Disposable {
	response: StreamedPHPResponse;
}

// Run a WP-CLI command in a PHP-WASM instance. This function can be used even if the targeted
// Studio site is already running, but it is typically faster to use the `sendWpCliCommand`
// function in that case.
export async function runWpCliCommand(
	siteFolder: string,
	phpVersion: SupportedPHPVersion,
	args: string[]
): Promise< DisposableWpCliResponse > {
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

		php.defineConstant( 'WP_SQLITE_AST_DRIVER', true );

		php.mkdir( '/wordpress' );
		await php.mount( '/wordpress', createNodeFsMountHandler( siteFolder ) );

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
		await setupSqliteIntegration( php );

		const response = await php.cli( [ 'php', '/tmp/wp-cli.phar', '--path=/wordpress', ...args ] );

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

/**
 * Run a global WP-CLI command without requiring a site.
 * Useful for commands like --version that don't need a WordPress installation.
 */
export async function runGlobalWpCliCommand( args: string[] ): Promise< DisposableWpCliResponse > {
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
