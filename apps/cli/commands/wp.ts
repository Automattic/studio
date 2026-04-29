import { spawn } from 'node:child_process';
import { validateNativePhpVersion } from '@studio/common/lib/php-binary-metadata';
import { __ } from '@wordpress/i18n';
import { ArgumentsCamelCase } from 'yargs';
import yargsParser from 'yargs-parser';
import { SiteData } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { getPhpBinaryPath, getWpCliPharPath } from 'cli/lib/dependency-management/paths';
import { runWpCliCommand, runGlobalWpCliCommand, WpCliResponse } from 'cli/lib/run-wp-cli-command';
import { validatePhpVersion } from 'cli/lib/utils';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

const logger = new Logger< '' >();

async function pipePHPResponse( response: WpCliResponse ) {
	const decoder = new TextDecoder();

	const stderrPipe = async () => {
		for await ( const chunk of response.stderr ) {
			process.stderr.write( chunk );
		}
	};

	const stdoutPipe = async () => {
		for await ( const chunk of response.stdout ) {
			const text = decoder.decode( chunk, { stream: true } );
			if ( ! text.startsWith( '#!/usr/bin/env' ) ) {
				process.stdout.write( chunk );
			}
		}
	};

	await Promise.all( [ stderrPipe(), stdoutPipe() ] );
}

enum Mode {
	GLOBAL = 'global',
	SITE = 'site',
}

async function runNativePhpWpCliCommand( site: SiteData, args: string[] ): Promise< void > {
	const phpVersion = validateNativePhpVersion( site.phpVersion );
	const child = spawn(
		getPhpBinaryPath( phpVersion ),
		[ getWpCliPharPath(), `--path=${ site.path }`, ...args ],
		{
			cwd: site.path,
			stdio: 'inherit',
		}
	);

	const { code, signal } = await new Promise< {
		code: number | null;
		signal: NodeJS.Signals | null;
	} >( ( resolve, reject ) => {
		child.once( 'error', reject );
		child.once( 'exit', ( exitCode, exitSignal ) =>
			resolve( { code: exitCode, signal: exitSignal } )
		);
	} );

	if ( signal ) {
		process.kill( process.pid, signal );
		return;
	}

	process.exit( code ?? 1 );
}

export async function runCommand(
	mode: Mode,
	siteFolder: string,
	args: string[],
	options: { phpVersion?: string } = {}
): Promise< void > {
	// Handle global WP-CLI commands that don't require a site path (--studio-no-path)
	if ( mode === Mode.GLOBAL ) {
		await using command = await runGlobalWpCliCommand( args );

		await pipePHPResponse( command.response );
		process.exitCode = await command.response.exitCode;

		return;
	}

	const site = await getSiteByFolder( siteFolder );

	if ( site.runtime === 'native-php' ) {
		await runNativePhpWpCliCommand( site, args );
		return;
	}

	const phpVersion = validatePhpVersion( options.phpVersion ?? site.phpVersion );

	// If there's already a running Playground instance for this site AND we're not requesting
	// a different PHP version, pass the command to it…
	const useCustomPhpVersion = options.phpVersion && options.phpVersion !== site.phpVersion;

	if ( ! useCustomPhpVersion ) {
		process.on( 'SIGINT', disconnectFromDaemon );
		process.on( 'SIGTERM', disconnectFromDaemon );

		try {
			await connectToDaemon();

			if ( await isServerRunning( site.id ) ) {
				const result = await sendWpCliCommand( site.id, args );
				process.stdout.write( result.stdout );
				process.stderr.write( result.stderr );
				process.exit( result.exitCode );
			}
		} finally {
			await disconnectFromDaemon();
		}
	}

	process.on( 'SIGINT', () => process.exit( 1 ) );
	process.on( 'SIGTERM', () => process.exit( 1 ) );

	// …If not, run the command in a new runtime instance (PHP-WASM or native PHP)
	await using command = await runWpCliCommand( site, args, { phpVersion } );

	await pipePHPResponse( command.response );
	process.exitCode = await command.response.exitCode;
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

interface WpCommandOptions extends GlobalOptions {
	studioNoPath?: boolean;
}

export async function commandHandler( argv: ArgumentsCamelCase< WpCommandOptions > ) {
	try {
		let wpCliArgv = removeArgumentFromArgv( process.argv.slice( 3 ), 'path' );
		wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'studio-no-path', false );
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

		await runCommand( argv.studioNoPath ? Mode.GLOBAL : Mode.SITE, argv.path, wpCliArgv, {
			phpVersion,
		} );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to run WP-CLI command' ), error );
			logger.reportError( loggerError );
		}
	}
}
