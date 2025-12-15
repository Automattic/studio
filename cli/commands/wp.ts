import { __ } from '@wordpress/i18n';
import { ArgumentsCamelCase } from 'yargs';
import yargsParser from 'yargs-parser';
import { getSiteByFolder } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { validatePhpVersion } from 'cli/lib/utils';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

const logger = new Logger< '' >();

export async function runCommand(
	siteFolder: string,
	args: string[],
	options: {
		phpVersion?: string;
	} = {}
): Promise< void > {
	const site = await getSiteByFolder( siteFolder );
	const phpVersion = validatePhpVersion( options.phpVersion ?? site.phpVersion );

	// If there's already a running Playground instance for this site AND we're not requesting
	// a different PHP version, pass the command to it…
	const useCustomPhpVersion = options.phpVersion && options.phpVersion !== site.phpVersion;

	if ( ! useCustomPhpVersion ) {
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
	}

	// …If not, instantiate a new Playground instance
	const [ response, closeWpCliServer ] = await runWpCliCommand(
		siteFolder,
		phpVersion,
		site.port,
		args
	);

	const stdout = await response.stdoutText;
	const stderr = await response.stderrText;
	const exitCode = await response.exitCode;

	process.stdout.write( stdout );
	process.stderr.write( stderr );

	await closeWpCliServer();
	process.exit( exitCode );
}

function removeArgumentFromArgv( argv: string[], argName: string ): string[] {
	argv = argv.slice( 0 );

	while ( argv.indexOf( `--${ argName }` ) !== -1 ) {
		const argIndex = argv.indexOf( `--${ argName }` );
		argv.splice( argIndex, 2 );
	}

	while ( argv.find( ( arg ) => arg.startsWith( `--${ argName }=` ) ) ) {
		const argIndex = argv.findIndex( ( arg ) => arg.startsWith( `--${ argName }=` ) );
		argv.splice( argIndex, 1 );
	}

	return argv;
}

export async function commandHandler( argv: ArgumentsCamelCase< GlobalOptions > ) {
	try {
		let wpCliArgv = removeArgumentFromArgv( process.argv.slice( 3 ), 'path' );
		const parsedWpCliArgs = yargsParser( wpCliArgv );

		if ( parsedWpCliArgs._[ 0 ] === 'shell' ) {
			throw new LoggerError(
				__(
					'Studio CLI does not support the WP-CLI `shell` command. Consider adding your code to a file and using the `eval` command.'
				)
			);
		}

		const phpVersion = parsedWpCliArgs[ 'php-version' ] as string | undefined;
		wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'php-version' );
		wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'avoid-telemetry' );

		await runCommand( argv.path, wpCliArgv, { phpVersion } );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to run WP-CLI command' ), error );
			logger.reportError( loggerError );
		}
	}
}
