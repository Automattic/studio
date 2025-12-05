import { __ } from '@wordpress/i18n';
import { runCLI } from '@wp-playground/cli';
import { getMuPlugins } from 'common/lib/mu-plugins';
import { WPCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { ArgumentsCamelCase } from 'yargs';
import { getSiteByFolder } from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

const logger = new Logger< LoggerAction >();

export async function runCommand( siteFolder: string, args: string[] ): Promise< void > {
	const site = await getSiteByFolder( siteFolder );
	console.log( 'PHP version:', site.phpVersion, siteFolder );

	// Mount mu-plugins
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
	];

	const result = await runCLI( {
		command: 'server',
		followSymlinks: true,
		'mount-before-install': mounts,
		'site-url': `http://localhost:${ site.port }`,
		verbosity: 'quiet',
		port: site.port,
		wordpressInstallMode: 'install-from-existing-files-if-needed',
		php: '8.3',
		blueprint: {
			constants: {
				WP_SQLITE_AST_DRIVER: true,
			},
			extraLibraries: [ 'wp-cli' ],
		},
	} );

	const response = await result.playground.cli( [
		'php',
		'/tmp/wp-cli.phar',
		`--path=${ await result.playground.documentRoot }`,
		...args,
	] );

	console.log( await response.stdoutText );
	process.exit( await response.exitCode );
}

export async function commandHandler( argv: ArgumentsCamelCase< GlobalOptions > ) {
	try {
		const wpcliArgs = process.argv.slice( 3 );
		const pathIndex = wpcliArgs.findIndex( ( arg ) => arg === '--path' );
		if ( pathIndex !== -1 ) {
			wpcliArgs.splice( pathIndex, 2 );
		}
		await runCommand( argv.path, wpcliArgs );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to run WP-CLI command' ), error );
			logger.reportError( loggerError );
		}
	}
}
