import path from 'path';
import { __ } from '@wordpress/i18n';
import { ArgumentsCamelCase } from 'yargs';
import yargsParser from 'yargs-parser';
import { getSiteContainingFolder } from 'cli/lib/cli-config/sites';
import { getPhpChildEnv } from 'cli/lib/native-php/php-process';
import {
	prepareWpCliCommand,
	runWpCliCommand,
	type WpCliProcess,
} from 'cli/lib/run-wp-cli-command';
import { untildify, validatePhpVersion } from 'cli/lib/utils';
import { getUnsupportedWpCliOptionMessage } from 'cli/lib/wp-cli-options';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';
import type { SiteData } from 'cli/lib/cli-config/core';

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

/**
 * What `studio wp` runs for the arguments after `wp`, given in folder `cwd`
 * with environment `env`: the site's WP-CLI process, for the site at `--path`
 * or containing `cwd`, or a LoggerError saying why it does not run.
 */
export async function resolveWpCliProcess(
	cwd: string,
	argv: string[],
	env: NodeJS.ProcessEnv,
	findSite: ( folder: string ) => Promise< SiteData > = getSiteContainingFolder
): Promise< WpCliProcess & { env: NodeJS.ProcessEnv } > {
	const { args, phpVersion } = parseWpCliArgv( argv );
	// `studio wp`'s site is its global --path (-p) option, as yargs reads it.
	const { path: sitePath } = yargsParser( argv, {
		string: [ 'path' ],
		alias: { path: [ 'p' ] },
	} );
	const site = await findSite(
		sitePath ? path.resolve( cwd, untildify( String( sitePath ) ) ) : cwd
	);
	const command = await prepareWpCliCommand( site, args, {
		phpVersion: validatePhpVersion( phpVersion ?? site.phpVersion ),
	} );
	return { ...command, env: getPhpChildEnv( undefined, env ) };
}

function parseWpCliArgv( argv: string[] ): { args: string[]; phpVersion?: string } {
	let wpCliArgv = removeArgumentFromArgv( argv, 'path' );
	const parsedWpCliArgs = yargsParser( wpCliArgv );

	if ( parsedWpCliArgs._[ 0 ] === 'shell' ) {
		throw new LoggerError(
			__(
				'Studio CLI does not support the WP-CLI `shell` command. Consider adding your code to a file and using the `eval` command.'
			)
		);
	}

	const unsupportedOptionMessage = getUnsupportedWpCliOptionMessage( wpCliArgv );
	if ( unsupportedOptionMessage ) {
		throw new LoggerError( unsupportedOptionMessage );
	}

	const phpVersion =
		parsedWpCliArgs[ 'php-version' ] !== undefined
			? String( parsedWpCliArgs[ 'php-version' ] )
			: undefined;
	wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'php-version' );
	wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'avoid-telemetry', false );
	return { args: wpCliArgv, phpVersion };
}

export async function commandHandler( argv: ArgumentsCamelCase< GlobalOptions > ) {
	try {
		const { args, phpVersion } = parseWpCliArgv( process.argv.slice( 3 ) );
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
