import { __ } from '@wordpress/i18n';
import { ArgumentsCamelCase } from 'yargs';
import yargsParser from 'yargs-parser';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { validatePhpVersion } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

const logger = new Logger< '' >();

export async function runCommand(
	siteFolder: string,
	args: string[],
	options: { phpVersion?: string } = {}
): Promise< void > {
	const site = await getSiteByFolder( siteFolder );
	const phpVersion = validatePhpVersion( options.phpVersion ?? site.phpVersion );

	// Connect the PHP child directly to the terminal for piped/interactive stdin, live
	// streaming output and colors. `reapPhpTreeOnInterrupt` handles Ctrl+C.
	await using command = await runWpCliCommand( site, args, { phpVersion, stdio: 'inherit' } );
	process.exitCode = await command.exitCode;
}

function removeArgumentFromArgv(
	argv: string[],
	argName: string,
	hasValue: boolean = true
): string[] {
	argv = argv.slice( 0 );

	while ( argv.indexOf( `--${ argName }` ) !== -1 ) {
		const argIndex = argv.indexOf( `--${ argName }` );
		// Remove 2 elements for --arg value, or 1 element for boolean flags like --no-path
		argv.splice( argIndex, hasValue ? 2 : 1 );
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

		const phpVersion =
			parsedWpCliArgs[ 'php-version' ] !== undefined
				? String( parsedWpCliArgs[ 'php-version' ] )
				: undefined;
		wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'php-version' );
		wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'avoid-telemetry', false );

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
