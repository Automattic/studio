import { rootCertificates } from 'node:tls';
import { loadNodeRuntime, createNodeFsMountHandler } from '@php-wasm/node';
import {
	StreamedPHPResponse,
	SupportedPHPVersion,
	PHP,
	setPhpIniEntries,
} from '@php-wasm/universal';
import { __ } from '@wordpress/i18n';
import { setupPlatformLevelMuPlugins } from '@wp-playground/wordpress';
import { getMuPlugins } from 'common/lib/mu-plugins';
import { LatestSupportedPHPVersion } from 'common/types/php-versions';
import { getSqliteCommandPath, getWpCliPharPath } from 'cli/lib/server-files';

const PLAYGROUND_INTERNAL_SHARED_FOLDER = '/internal/shared';

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
	const id = await loadNodeRuntime( phpVersion, { followSymlinks: true } );
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
			// Disable process spawning functions as they're not supported in WASM
			// without a spawn handler. WP-CLI's search-replace tries to use these.
			disable_functions:
				'exec,passthru,shell_exec,system,proc_open,popen,proc_close,proc_get_status,proc_nice,proc_terminate,pcntl_exec',
		} );

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
	const id = await loadNodeRuntime( LatestSupportedPHPVersion, { followSymlinks: true } );
	const php = new PHP( id );

	try {
		await php.setSapiName( 'cli' );

		// Setup SSL certificates
		php.writeFile( '/tmp/ca-bundle.crt', rootCertificates.join( '\n' ) );
		await setPhpIniEntries( php, {
			'openssl.cafile': '/tmp/ca-bundle.crt',
			allow_url_fopen: 1,
			// Disable process spawning functions as they're not supported in WASM
			// without a spawn handler. WP-CLI's search-replace tries to use these.
			disable_functions:
				'exec,passthru,shell_exec,system,proc_open,popen,proc_close,proc_get_status,proc_nice,proc_terminate,pcntl_exec',
		} );

		await php.mount( '/tmp/wp-cli.phar', createNodeFsMountHandler( getWpCliPharPath() ) );

		return [ await php.cli( [ 'php', '/tmp/wp-cli.phar', ...args ] ), () => php.exit() ];
	} catch ( error ) {
		throw new Error( __( 'An error occurred while running the WP-CLI command.' ) );
	}
}
