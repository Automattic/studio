import { SupportedPHPVersion, SupportedPHPVersions } from '@php-wasm/universal';
import { __, sprintf } from '@wordpress/i18n';
import { runCLI } from '@wp-playground/cli';
import { getMuPlugins } from 'common/lib/mu-plugins';
import { WPCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { ArgumentsCamelCase } from 'yargs';
import yargsParser from 'yargs-parser';
import { z } from 'zod';
import { getSiteByFolder } from 'cli/lib/appdata';
import { getWpCliPharPath } from 'cli/lib/sqlite-integration';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CliArgs = Record< string, any >;

const logger = new Logger< LoggerAction >();

export async function runCommand( siteFolder: string, args: string[] ): Promise< void > {
	const site = await getSiteByFolder( siteFolder );
	const phpVersionSchema = z.enum( SupportedPHPVersions );
	let phpVersion: SupportedPHPVersion;

	try {
		phpVersion = phpVersionSchema.parse( site.phpVersion );
	} catch ( error ) {
		throw new LoggerError( sprintf( __( 'Invalid PHP version: %s' ), site.phpVersion ) );
	}

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

	const result = await runCLI( {
		command: 'server',
		followSymlinks: true,
		'mount-before-install': mounts,
		'site-url': `http://localhost:${ site.port }`,
		verbosity: 'quiet',
		wordpressInstallMode: 'do-not-attempt-installing',
		php: phpVersion,
		blueprint: {
			constants: {
				WP_SQLITE_AST_DRIVER: true,
			},
		},
	} );

	const response = await result.playground.cli( [
		'php',
		'/tmp/wp-cli.phar',
		`--path=${ await result.playground.documentRoot }`,
		...args,
	] );

	await response.stderr.pipeTo(
		new WritableStream( {
			write( chunk ) {
				process.stderr.write( chunk );
			},
		} )
	);

	await response.stdout.pipeTo(
		new WritableStream( {
			write( chunk ) {
				process.stdout.write( chunk );
			},
		} )
	);

	process.exit( await response.exitCode );
}

export async function commandHandler( argv: ArgumentsCamelCase< GlobalOptions > ) {
	try {
		const wpcliArgs: CliArgs = yargsParser( process.argv.slice( 3 ) );
		delete wpcliArgs.path;
		const argsArray = [ ...wpcliArgs._ ];
		delete wpcliArgs._;
		argsArray.push( ...Object.entries( wpcliArgs ).flat() );

		await runCommand( argv.path, argsArray );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to run WP-CLI command' ), error );
			logger.reportError( loggerError );
		}
	}
}
