import { SupportedPHPVersion, SupportedPHPVersions } from '@php-wasm/universal';
import { __, sprintf } from '@wordpress/i18n';
import { runCLI } from '@wp-playground/cli';
import { getMuPlugins } from 'common/lib/mu-plugins';
import { ArgumentsCamelCase } from 'yargs';
import yargsParser from 'yargs-parser';
import { z } from 'zod';
import { getSiteByFolder } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { getWpCliPharPath } from 'cli/lib/server-files';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

const logger = new Logger< '' >();

export async function runCommand( siteFolder: string, args: string[] ): Promise< void > {
	const site = await getSiteByFolder( siteFolder );

	// If there's already a running Playground instance for this site, pass the command to it…
	try {
		await connect();

		if ( await isServerRunning( site.id ) ) {
			const result = await sendWpCliCommand( site.id, args );
			process.stdout.write( result.stdout );
			process.stderr.write( result.stderr );
			process.exit( result.exitCode );
		}
	} finally {
		disconnect();
	}

	// …If not, instantiate a new Playground instance in the main process
	const phpVersionSchema = z.enum( SupportedPHPVersions );
	let phpVersion: SupportedPHPVersion;

	try {
		phpVersion = phpVersionSchema.parse( site.phpVersion );
	} catch ( error ) {
		throw new LoggerError( sprintf( __( 'Unsupported PHP version: %s' ), site.phpVersion ) );
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

function removePathArgumentFromArgv( argv: string[] ) {
	argv = argv.slice( 0 );

	while ( argv.indexOf( '--path' ) !== -1 ) {
		const pathIndex = argv.indexOf( '--path' );
		argv.splice( pathIndex, 2 );
	}

	while ( argv.find( ( arg ) => /^--path=/.test( arg ) ) ) {
		const pathIndex = argv.findIndex( ( arg ) => /^--path=/.test( arg ) );
		argv.splice( pathIndex, 1 );
	}

	return argv;
}

export async function commandHandler( argv: ArgumentsCamelCase< GlobalOptions > ) {
	try {
		const wpCliArgv = removePathArgumentFromArgv( process.argv.slice( 3 ) );
		const parsedWpCliArgs = yargsParser( wpCliArgv );

		if ( parsedWpCliArgs._[ 0 ] === 'shell' ) {
			throw new LoggerError(
				__(
					'Studio CLI does not support the WP-CLI `shell` command. Consider adding your code to a file and using the `eval` command.'
				)
			);
		}

		await runCommand( argv.path, wpCliArgv );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to run WP-CLI command' ), error );
			logger.reportError( loggerError );
		}
	}
}
