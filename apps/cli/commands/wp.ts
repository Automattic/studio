import { __ } from '@wordpress/i18n';
import { ArgumentsCamelCase } from 'yargs';
import { getSiteContainingFolder } from 'cli/lib/cli-config/sites';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { parseStudioWpArguments } from 'cli/lib/studio-wp-command';
import { validatePhpVersion } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

const logger = new Logger< '' >();

export async function runCommand(
	siteFolder: string,
	args: string[],
	options: { phpVersion?: string } = {}
): Promise< void > {
	const site = await getSiteContainingFolder( siteFolder );
	const phpVersion = validatePhpVersion( options.phpVersion ?? site.phpVersion );

	// Connect the PHP child directly to the terminal for piped/interactive stdin, live
	// streaming output and colors. `reapPhpTreeOnInterrupt` handles Ctrl+C.
	await using command = await runWpCliCommand( site, args, { phpVersion, stdio: 'inherit' } );
	process.exitCode = await command.exitCode;
}

export async function commandHandler( argv: ArgumentsCamelCase< GlobalOptions > ) {
	try {
		// `--path` is Studio's global option, already parsed into `argv.path`.
		const { args, phpVersion } = parseStudioWpArguments( process.argv.slice( 3 ) );
		await runCommand( argv.path, args, { phpVersion } );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to run WP-CLI command' ), error );
			logger.reportError( loggerError );
		}
	}
}
