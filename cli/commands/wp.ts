import { readFileSync } from 'fs';
import nodePath from 'path';
import { rootCertificates } from 'tls';
import { createNodeFsMountHandler, loadNodeRuntime } from '@php-wasm/node';
import { PHP, SupportedPHPVersion, setPhpIniEntries } from '@php-wasm/universal';
import { __ } from '@wordpress/i18n';
import { pathExists } from 'common/lib/fs-utils';
import { WPCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { ArgumentsCamelCase } from 'yargs';
import { getSiteByFolder } from 'cli/lib/appdata';
import { getSqliteCommandPath, getWpCliPharPath } from 'cli/lib/sqlite-integration';
import { Logger, LoggerError } from 'cli/logger';
import { GlobalOptions } from 'cli/types';

const PLAYGROUND_PATHS = {
	documentRoot: '/wordpress',
	internalSharedFolder: '/internal/shared',
	runCliScript: '/tmp/run-cli.php',
	stderr: '/tmp/stderr',
	sqliteCommand: '/tmp/sqlite-command',
	wpCliPhar: '/tmp/wp-cli.phar',
} as const;

const logger = new Logger< LoggerAction >();

// Create PHP script to execute WP-CLI (similar to wp-now approach)
function getPhpScriptContents( args: string[] ) {
	return `<?php
// Set up CLI environment
putenv( 'SHELL_PIPE=0' );

// Set the argv global for WP-CLI
$GLOBALS['argv'] = array_merge([
	"${ PLAYGROUND_PATHS.wpCliPhar }",
	"--path=${ PLAYGROUND_PATHS.documentRoot }",
], ${ JSON.stringify( args ) });

// Provide CLI streams
define('STDIN', fopen('php://stdin', 'rb'));
define('STDOUT', fopen('php://stdout', 'wb'));
define('STDERR', fopen('${ PLAYGROUND_PATHS.stderr }', 'wb'));

// Set server argv for WP-CLI
$_SERVER['argv'] = $GLOBALS['argv'];
$_SERVER['argc'] = count($_SERVER['argv']);

// Include WP-CLI phar
if (file_exists("${ PLAYGROUND_PATHS.wpCliPhar }")) {
	require "${ PLAYGROUND_PATHS.wpCliPhar }";
} else {
	echo "WP-CLI phar not found";
	exit(1);
}
`;
}

export async function runCommand( siteFolder: string, args: string[] ): Promise< void > {
	const site = await getSiteByFolder( siteFolder );
	console.log( 'PHP version:', site.phpVersion, siteFolder );
	const id = await loadNodeRuntime( site.phpVersion as SupportedPHPVersion, {
		followSymlinks: true,
	} );

	const php = new PHP( id );

	try {
		await php.setSapiName( 'cli' );

		// Mount project files to /wordpress (WordPress root)
		php.mkdir( PLAYGROUND_PATHS.documentRoot );
		await php.mount( PLAYGROUND_PATHS.documentRoot, createNodeFsMountHandler( siteFolder ) );

		// Mount SQLite command
		const sqliteCommandPath = getSqliteCommandPath();
		if ( await pathExists( sqliteCommandPath ) ) {
			php.mkdir( PLAYGROUND_PATHS.sqliteCommand );
			await php.mount(
				PLAYGROUND_PATHS.sqliteCommand,
				createNodeFsMountHandler( sqliteCommandPath )
			);
		}

		// Mount WP-CLI phar
		const wpCliPharPath = getWpCliPharPath();
		if ( await pathExists( wpCliPharPath ) ) {
			php.mkdir( nodePath.posix.dirname( PLAYGROUND_PATHS.wpCliPhar ) );
			php.writeFile( PLAYGROUND_PATHS.wpCliPhar, readFileSync( wpCliPharPath ) );
		}

		// Create CA bundle certificate file for SSL verification (following wp-now approach)
		php.mkdir( PLAYGROUND_PATHS.internalSharedFolder );
		const caBundlePath = nodePath.posix.join(
			PLAYGROUND_PATHS.internalSharedFolder,
			'ca-bundle.crt'
		);
		php.writeFile( caBundlePath, rootCertificates.join( '\n' ) );

		await setPhpIniEntries( php, {
			'openssl.cafile': caBundlePath,
		} );

		console.log( 'Executing WP-CLI command:', args );

		const phpScript = getPhpScriptContents( args );
		php.writeFile( PLAYGROUND_PATHS.runCliScript, phpScript );
		php.writeFile( PLAYGROUND_PATHS.stderr, '' );

		const result = await php.run( {
			scriptPath: PLAYGROUND_PATHS.runCliScript,
		} );

		const stderr = php.readFileAsText( PLAYGROUND_PATHS.stderr ).trim();

		const cleanStdout = result.text
			.split( '\n' )
			.filter( ( line ) => ! line.startsWith( '#!/' ) )
			.join( '\n' )
			.trim();

		console.log( {
			stdout: cleanStdout,
			stderr: stderr,
			exitCode: result.exitCode,
		} );

		/*
		const streamedResponse = await php.runStream( {
			scriptPath: runCliPath,
		} );

		const stdoutReader = streamedResponse.stdout.getReader();
		const stderrReader = streamedResponse.stderr.getReader();
		const decoder = new TextDecoder();

		try {
			while ( true ) {
				const { done: stdoutDone, value: stdoutValue } = await stdoutReader.read();
				if ( ! stdoutDone ) {
					const stdoutChunk = decoder.decode( stdoutValue, { stream: true } );
					process.stdout.write( stdoutChunk );
				}

				const { done: stderrDone, value: stderrValue } = await stderrReader.read();
				if ( ! stderrDone ) {
					const stderrChunk = decoder.decode( stderrValue, { stream: true } );
					console.error( stderrValue );
					process.stderr.write( stderrChunk );
				}

				if ( stdoutDone && stderrDone ) {
					break;
				}
			}
		} finally {
			stdoutReader.releaseLock();
			stderrReader.releaseLock();
		}

		const exitCode = await streamedResponse.exitCode;
		process.exitCode = exitCode;
		*/
	} finally {
		// Clean up PHP instance
		php.exit();
	}
}

export async function commandHandler( argv: ArgumentsCamelCase< GlobalOptions > ) {
	try {
		const wpcliArgs = process.argv.slice( 3 );
		const pathIndex = wpcliArgs.findIndex( ( arg ) => arg === '--path' );
		if ( pathIndex !== -1 ) {
			wpcliArgs.splice( pathIndex, 2 );
		}
		await runCommand( argv.path, wpcliArgs );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to run WP-CLI command' ), error );
			logger.reportError( loggerError );
		}
	}
}
