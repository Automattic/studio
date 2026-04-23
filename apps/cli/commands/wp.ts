import { StreamedPHPResponse } from '@php-wasm/universal';
import { __ } from '@wordpress/i18n';
import { ArgumentsCamelCase } from 'yargs';
import yargsParser from 'yargs-parser';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand, runGlobalWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { validatePhpVersion } from 'cli/lib/utils';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

const logger = new Logger< '' >();

async function pipePHPResponse( response: StreamedPHPResponse ) {
	const decoder = new TextDecoder();

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
				const text = decoder.decode( chunk, { stream: true } );
				if ( ! text.startsWith( '#!/usr/bin/env' ) ) {
					process.stdout.write( chunk );
				}
			},
		} )
	);
}

enum Mode {
	GLOBAL = 'global',
	SITE = 'site',
}

/**
 * Drain `process.stdin` to a Buffer when this Studio CLI invocation
 * was piped into (e.g. `echo foo | studio wp eval ...`). Returns
 * `undefined` when stdin is a TTY (interactive shell) so we never
 * block reading from a terminal.
 *
 * Reads bytes synchronously into memory before the WP-CLI command
 * runs. The buffer is then forwarded to the PHP runtime via the
 * `stdin` option on `php.cli()` (Playground PR adding that option
 * is the upstream half of this fix). Without this draining step,
 * host stdin would never reach PHP — the daemon path runs in a
 * separate process from `studio wp` and the in-proc path runs in a
 * worker thread, neither of which has the user's pipe attached.
 */
async function drainHostStdin(): Promise< Buffer | undefined > {
	if ( process.stdin.isTTY ) {
		return undefined;
	}
	const chunks: Buffer[] = [];
	for await ( const chunk of process.stdin ) {
		chunks.push( chunk as Buffer );
	}
	return chunks.length > 0 ? Buffer.concat( chunks ) : undefined;
}

export async function runCommand(
	mode: Mode,
	siteFolder: string,
	args: string[],
	options: { phpVersion?: string } = {}
): Promise< void > {
	// Handle global WP-CLI commands that don't require a site path (--studio-no-path)
	if ( mode === Mode.GLOBAL ) {
		const stdin = await drainHostStdin();
		await using command = await runGlobalWpCliCommand( args, { stdin } );

		await pipePHPResponse( command.response );
		process.exitCode = await command.response.exitCode;

		return;
	}

	const site = await getSiteByFolder( siteFolder );
	const phpVersion = validatePhpVersion( options.phpVersion ?? site.phpVersion );

	// Drain piped stdin (if any) up-front so we can forward it to whichever
	// WP-CLI execution path we end up on. Both the daemon IPC and in-proc
	// paths route the bytes through `php.cli({ stdin })`.
	const stdin = await drainHostStdin();

	// If there's already a running Playground instance for this site AND we're not requesting
	// a different PHP version, pass the command to it…
	const useCustomPhpVersion = options.phpVersion && options.phpVersion !== site.phpVersion;

	if ( ! useCustomPhpVersion ) {
		process.on( 'SIGINT', disconnectFromDaemon );
		process.on( 'SIGTERM', disconnectFromDaemon );

		try {
			await connectToDaemon();

			if ( await isServerRunning( site.id ) ) {
				const result = await sendWpCliCommand( site.id, args, stdin );
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

	// …If not, run the command in a new PHP-WASM instance
	await using command = await runWpCliCommand( siteFolder, phpVersion, args, {
		stdin,
	} );

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
