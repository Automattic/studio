import { rootCertificates } from 'node:tls';
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';
import {
	StreamedPHPResponse,
	SupportedPHPVersion,
	PHP,
	setPhpIniEntries,
} from '@php-wasm/universal';
import { createSpawnHandler } from '@php-wasm/util';
import { getMuPlugins } from '@studio/common/lib/mu-plugins';
import { LatestSupportedPHPVersion } from '@studio/common/types/php-versions';
import { __ } from '@wordpress/i18n';
import { setupPlatformLevelMuPlugins } from '@wp-playground/wordpress';
import { getSqliteCommandPath, getWpCliPharPath } from 'cli/lib/server-files';

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

// Run a WP-CLI command in a PHP-WASM instance. This function can be used even if the targeted
// Studio site is already running, but it is typically faster to use the `sendWpCliCommand`
// function in that case.
export async function runWpCliCommand(
	siteFolder: string,
	phpVersion: SupportedPHPVersion,
	args: string[]
): Promise< [ StreamedPHPResponse, exitPhp: () => void ] > {
	const id = await loadNodeRuntime( phpVersion, {
		followSymlinks: true,
		withRedis: true,
		withMemcached: true,
	} );
	const php = new PHP( id );

	try {
		await php.setSapiName( 'cli' );

		php.mkdir( '/wordpress' );
		await php.mount( '/wordpress', createNodeFsMountHandler( siteFolder ) );

		// Setup SSL certificates
		php.writeFile( '/tmp/ca-bundle.crt', rootCertificates.join( '\n' ) );
		await setPhpIniEntries( php, {
			'openssl.cafile': '/tmp/ca-bundle.crt',
			allow_url_fopen: 1,
		} );

		await php.setSpawnHandler( createNoopSpawnHandler() );

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

		return [
			await php.cli( [ 'php', '/tmp/wp-cli.phar', '--path=/wordpress', ...args ] ),
			() => php.exit(),
		];
	} catch ( error ) {
		throw new Error( __( 'An error occurred while running the WP-CLI command.' ) );
	}
}

/**
 * Run a global WP-CLI command without requiring a site.
 * Useful for commands like --version that don't need a WordPress installation.
 */
export async function runGlobalWpCliCommand(
	args: string[]
): Promise< [ StreamedPHPResponse, exitPhp: () => void ] > {
	const id = await loadNodeRuntime( LatestSupportedPHPVersion, {
		followSymlinks: true,
		withRedis: true,
		withMemcached: true,
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

		return [ await php.cli( [ 'php', '/tmp/wp-cli.phar', ...args ] ), () => php.exit() ];
	} catch ( error ) {
		throw new Error( __( 'An error occurred while running the WP-CLI command.' ) );
	}
}
