import { StreamedPHPResponse, SupportedPHPVersion } from '@php-wasm/universal';
import { __ } from '@wordpress/i18n';
import { runCLI } from '@wp-playground/cli';
import { getMuPlugins } from 'common/lib/mu-plugins';
import { getWpCliPharPath } from 'cli/lib/server-files';

// Run a WP-CLI command in a Playground instance using a random port. This function can be used
// even if the targeted Studio site is already running, but it is typically faster to use the
// `sendWpCliCommand` function in that case.
export async function runWpCliCommand(
	siteFolder: string,
	phpVersion: SupportedPHPVersion,
	sitePort: number,
	args: string[]
): Promise< [ StreamedPHPResponse, closeServer: () => Promise< void > ] > {
	const [ studioMuPluginsHostPath, loaderMuPluginHostPath ] = await getMuPlugins( {
		isWpAutoUpdating: false,
	} );

	const mounts = [
		{
			hostPath: siteFolder,
			vfsPath: '/wordpress',
		},
		{
			hostPath: studioMuPluginsHostPath,
			vfsPath: '/internal/studio/mu-plugins',
		},
		{
			hostPath: loaderMuPluginHostPath,
			vfsPath: '/internal/shared/mu-plugins/99-studio-loader.php',
		},
		{
			hostPath: getWpCliPharPath(),
			vfsPath: '/tmp/wp-cli.phar',
		},
	];

	const runCliServer = await runCLI( {
		command: 'server',
		followSymlinks: true,
		'mount-before-install': mounts,
		'site-url': `http://localhost:${ sitePort }`,
		verbosity: 'quiet',
		wordpressInstallMode: 'do-not-attempt-installing',
		php: phpVersion,
		blueprint: {
			constants: {
				WP_SQLITE_AST_DRIVER: true,
			},
		},
	} );

	const result = await runCliServer.playground.cli( [
		'php',
		'/tmp/wp-cli.phar',
		`--path=${ await runCliServer.playground.documentRoot }`,
		...args,
	] );

	// FIXME: Calling this function will clean up the Playground instance, but it's apparently not
	// enough to clean up all open handles. For now, you must also call process.exit()
	function closeServer() {
		return new Promise< void >( ( resolve, reject ) => {
			runCliServer.server.close( ( error ) => {
				if ( error ) {
					reject( error );
				} else {
					resolve();
				}
			} );
		} );
	}

	return [ result, closeServer ];
}
