import path from 'node:path';
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
): Promise< StreamedPHPResponse > {
	const id = await loadNodeRuntime( phpVersion, { followSymlinks: true } );
	const php = new PHP( id );

	try {
		await php.setSapiName( 'cli' );

		php.mkdir( '/wordpress' );
		await php.mount( '/wordpress', createNodeFsMountHandler( siteFolder ) );

		// Create CA bundle for SSL verification
		php.mkdir( PLAYGROUND_INTERNAL_SHARED_FOLDER );
		const caBundlePath = path.posix.join( PLAYGROUND_INTERNAL_SHARED_FOLDER, 'ca-bundle.crt' );
		php.writeFile( caBundlePath, rootCertificates.join( '\n' ) );

		await setPhpIniEntries( php, {
			'openssl.cafile': caBundlePath,
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

		const phpScript = `<?php
putenv( 'SHELL_PIPE=0' );

$GLOBALS['argv'] = array_merge([
	"/tmp/wp-cli.phar",
	"--path=/wordpress"
], ${ JSON.stringify( args ) });

define('STDIN', fopen('php://stdin', 'rb'));
define('STDOUT', fopen('php://stdout', 'wb'));
define('STDERR', fopen('php://stderr', 'wb'));

$_SERVER['argv'] = $GLOBALS['argv'];
$_SERVER['argc'] = count($_SERVER['argv']);

chdir('/wordpress');

if (file_exists('/tmp/wp-cli.phar')) {
	require '/tmp/wp-cli.phar';
} else {
	echo "WP-CLI phar not found";
	exit(1);
}
`;

		const runCliPath = '/tmp/run-cli.php';
		php.writeFile( runCliPath, phpScript );

		return await php.runStream( {
			scriptPath: runCliPath,
		} );
	} finally {
		php.exit();
	}
}
