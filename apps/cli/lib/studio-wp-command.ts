import path from 'node:path';
import { __ } from '@wordpress/i18n';
import yargsParser from 'yargs-parser';
import { getSiteContainingFolder } from 'cli/lib/cli-config/sites';
import { prepareWpCliCommand, type WpCliCommandLine } from 'cli/lib/run-wp-cli-command';
import { validatePhpVersion } from 'cli/lib/utils';
import { getUnsupportedWpCliOptionMessage } from 'cli/lib/wp-cli-options';
import { LoggerError } from 'cli/logger';

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

export type StudioWpArguments = {
	// The WP-CLI arguments, without the options `studio wp` handles itself.
	args: string[];
	// From `--path`: a folder inside the site to run on.
	folder?: string;
	phpVersion?: string;
};

// Splits the arguments of `studio wp <args>` into WP-CLI's and Studio's own.
export function parseStudioWpArguments( argv: string[] ): StudioWpArguments {
	const parsed = yargsParser( argv );

	if ( parsed._[ 0 ] === 'shell' ) {
		throw new LoggerError(
			__(
				'Studio CLI does not support the WP-CLI `shell` command. Consider adding your code to a file and using the `eval` command.'
			)
		);
	}

	const unsupportedOptionMessage = getUnsupportedWpCliOptionMessage( argv );
	if ( unsupportedOptionMessage ) {
		throw new LoggerError( unsupportedOptionMessage );
	}

	let args = removeArgumentFromArgv( argv, 'path' );
	args = removeArgumentFromArgv( args, 'php-version' );
	args = removeArgumentFromArgv( args, 'avoid-telemetry', false );
	return {
		args,
		folder: parsed.path !== undefined ? String( parsed.path ) : undefined,
		phpVersion:
			parsed[ 'php-version' ] !== undefined ? String( parsed[ 'php-version' ] ) : undefined,
	};
}

// The PHP process `studio wp <argv>` runs, run from `cwd`.
export async function prepareStudioWpCommand(
	cwd: string,
	argv: string[]
): Promise< WpCliCommandLine > {
	const { args, folder, phpVersion } = parseStudioWpArguments( argv );
	const site = await getSiteContainingFolder( path.resolve( cwd, folder ?? '.' ) );
	return prepareWpCliCommand( site, args, {
		phpVersion: validatePhpVersion( phpVersion ?? site.phpVersion ),
	} );
}
