import { SITE_RUNTIME_NATIVE_PHP, getSiteRuntime } from '@studio/common/lib/site-runtime';
import { __ } from '@wordpress/i18n';
import { ArgumentsCamelCase } from 'yargs';
import yargsParser from 'yargs-parser';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import {
	WpCliResponse,
	runWpCliCommandWithMessaging,
	runWpCliCommand,
} from 'cli/lib/run-wp-cli-command';
import { validatePhpVersion } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

const logger = new Logger< '' >();

// `response.stdout` is already shebang-stripped by `runWpCliCommand` /
// `runWpCliCommandWithMessaging`, so this just forwards the streams verbatim.
async function pipePHPResponse( response: WpCliResponse ) {
	const stderrPipe = async () => {
		for await ( const chunk of response.stderr ) {
			process.stderr.write( chunk );
		}
	};

	const stdoutPipe = async () => {
		for await ( const chunk of response.stdout ) {
			process.stdout.write( chunk );
		}
	};

	await Promise.all( [ stderrPipe(), stdoutPipe() ] );
}

export async function runCommand(
	siteFolder: string,
	args: string[],
	options: { phpVersion?: string } = {}
): Promise< void > {
	const site = await getSiteByFolder( siteFolder );
	const phpVersion = validatePhpVersion( options.phpVersion ?? site.phpVersion );

	// The native runtime always spawns a local PHP child, so connect it directly to
	// the terminal for piped/interactive stdin, live streaming output and colors. It
	// never uses the daemon, and `reapPhpTreeOnInterrupt` handles Ctrl+C, so there's
	// no daemon connection or signal handler to set up here.
	if ( getSiteRuntime( site ) === SITE_RUNTIME_NATIVE_PHP ) {
		await using command = await runWpCliCommand( site, args, { phpVersion, stdio: 'inherit' } );
		process.exitCode = await command.exitCode;
		return;
	}

	// Playground sites run in the daemon (when running) or a fresh in-process PHP-WASM
	// instance (when stopped), so their output can only be streamed, not inherited.
	const onSignal = async () => {
		await disconnectFromDaemon();
		process.exit( 1 );
	};
	process.on( 'SIGINT', onSignal );
	process.on( 'SIGTERM', onSignal );

	try {
		await connectToDaemon();

		const command = await runWpCliCommandWithMessaging( site, args, { phpVersion } );
		let disposed = false;
		const disposeCommand = () => {
			if ( ! disposed ) {
				disposed = true;
				command[ Symbol.dispose ]();
			}
		};
		try {
			const exitCode = await command.response.exitCode;

			// PHP-WASM owns the response streams. Release it after the command exits so
			// those streams can reach EOF before waiting for their output to drain.
			disposeCommand();
			await pipePHPResponse( command.response );
			process.exitCode = exitCode;
		} finally {
			disposeCommand();
		}
	} finally {
		await disconnectFromDaemon();
	}
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
