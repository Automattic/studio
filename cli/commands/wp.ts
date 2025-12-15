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
	const phpVersion = validatePhpVersion( site.phpVersion );
	const [ response, closeWpCliServer ] = await runWpCliCommand(
		siteFolder,
		phpVersion,
		site.port,
		args
	);

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

	await closeWpCliServer();
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
