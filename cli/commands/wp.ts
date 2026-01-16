import { __ } from '@wordpress/i18n';
import { ArgumentsCamelCase } from 'yargs';
import yargsParser from 'yargs-parser';
import { getSiteByFolder } from 'cli/lib/appdata';
import { connect, disconnect } from 'cli/lib/pm2-manager';
import { runWpCliCommand, runGlobalWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { validatePhpVersion } from 'cli/lib/utils';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

interface WpCommandOptions extends GlobalOptions {
	path: string | false;
}

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
		process.on( 'SIGINT', disconnect );
		process.on( 'SIGTERM', disconnect );

		try {
			await connect();

			if ( await isServerRunning( site.id ) ) {
				const result = await sendWpCliCommand( site.id, args );
				process.stdout.write( result.stdout );
				process.stderr.write( result.stderr );
				process.exit( result.exitCode );
			}
		} finally {
			await disconnect();
		}
	}

	process.on( 'SIGINT', () => process.exit( 1 ) );
	process.on( 'SIGTERM', () => process.exit( 1 ) );

	// …If not, run the command in a new PHP-WASM instance
	const [ response, exitPhp ] = await runWpCliCommand( siteFolder, phpVersion, args );
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

	process.exitCode = await response.exitCode;
	exitPhp();
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

export async function commandHandler( argv: ArgumentsCamelCase< WpCommandOptions > ) {
	try {
		let wpCliArgv = removeArgumentFromArgv( process.argv.slice( 3 ), 'path' );
		wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'no-path', false );
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
		wpCliArgv = removeArgumentFromArgv( wpCliArgv, 'avoid-telemetry', false );

		// Handle global WP-CLI commands that don't require a site path (--no-path sets path to false)
		if ( argv.path === false ) {
			const [ response, exitPhp ] = await runGlobalWpCliCommand( wpCliArgv );
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

			process.exitCode = await response.exitCode;
			exitPhp();
			return;
		}

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
