import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import { __, sprintf } from '@wordpress/i18n';
import { move } from 'fs-extra';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { replaceMysql8OnlyCollations } from 'cli/lib/sqlite-collations';
import { summarizeWpCliStderr } from 'cli/lib/wp-cli-stderr';
import { LoggerError } from 'cli/logger';
import type { ConfigSite } from '@studio/common/lib/config/schema';

async function createDatabaseExportError(
	message: string,
	stderrText: Promise< string >
): Promise< LoggerError > {
	const stderr = ( await stderrText ).trim();
	if ( ! stderr ) {
		return new LoggerError( message, undefined, 'database_export' );
	}
	console.error( message, stderr );
	return new LoggerError( message, new Error( summarizeWpCliStderr( stderr ) ), 'database_export' );
}

async function exportSqliteDump(
	site: ConfigSite,
	finalDestination: string,
	errorMessage: string,
	additionalArgs: string[] = []
): Promise< void > {
	const tempFileName = `studio-db-export-${ randomUUID() }.sql`;
	const tempFilePath = path.join( site.path, tempFileName );

	try {
		await using command = await runWpCliCommand(
			site,
			[
				'sqlite',
				'export',
				tempFileName,
				...additionalArgs,
				'--enable-ast-driver',
				'--skip-plugins',
				'--skip-themes',
			],
			{
				requireSqliteCliCommand: true,
				phpVersion: DEFAULT_PHP_VERSION,
			}
		);

		const exitCode = await command.response.exitCode;
		if ( exitCode !== 0 ) {
			throw await createDatabaseExportError( errorMessage, command.response.stderrText );
		}

		await move( tempFilePath, finalDestination );
	} finally {
		await rm( tempFilePath, { force: true } ).catch( ( error ) =>
			console.error( 'Failed to remove temporary database export:', error )
		);
	}
}

export async function exportDatabaseToFile(
	site: ConfigSite,
	finalDestination: string
): Promise< void > {
	// Exports don't start the site, so the start-time collation fix may not have run yet.
	await replaceMysql8OnlyCollations( site.path );
	await exportSqliteDump( site, finalDestination, __( 'Database export failed' ) );
}

export async function exportDatabaseToMultipleFiles(
	site: ConfigSite,
	finalDestinationDir: string
): Promise< string[] > {
	await replaceMysql8OnlyCollations( site.path );

	await using command = await runWpCliCommand(
		site,
		[
			'sqlite',
			'tables',
			'--format=json',
			'--enable-ast-driver',
			'--skip-plugins',
			'--skip-themes',
		],
		{
			requireSqliteCliCommand: true,
			phpVersion: DEFAULT_PHP_VERSION,
		}
	);

	const tablesStdout = await command.response.stdoutText;
	const exitCode = await command.response.exitCode;
	if ( exitCode !== 0 ) {
		throw await createDatabaseExportError(
			__( 'Database export failed' ),
			command.response.stderrText
		);
	}

	let tables;

	try {
		tables = parseJsonFromPhpOutput( tablesStdout );
	} catch ( error ) {
		console.error(
			sprintf( __( 'Could not get list of database tables. The WP CLI output: %s' ), tablesStdout )
		);
		throw new LoggerError(
			__( 'Could not get list of database tables to export.' ),
			undefined,
			'database_export'
		);
	}

	// A pulled site uses the remote's table prefix, so its users tables aren't always wp_users and
	// wp_usermeta.
	await using prefixCommand = await runWpCliCommand( site, [ 'config', 'get', 'table_prefix' ], {
		phpVersion: DEFAULT_PHP_VERSION,
	} );
	const tablePrefix = ( await prefixCommand.response.stdoutText ).trim();
	if ( ( await prefixCommand.response.exitCode ) !== 0 || ! tablePrefix ) {
		throw await createDatabaseExportError(
			__( 'Could not read the table prefix from wp-config.php' ),
			prefixCommand.response.stderrText
		);
	}

	const tmpFiles: string[] = [];

	for ( const table of tables ) {
		if ( table === `${ tablePrefix }users` || table === `${ tablePrefix }usermeta` ) {
			// Skip the users tables as they are not needed
			continue;
		}

		const fileName = `${ table }.sql`;
		const finalDestination = path.join( finalDestinationDir, fileName );
		await exportSqliteDump(
			site,
			finalDestination,
			sprintf( __( 'Database export failed for table %s' ), table ),
			[ `--tables=${ table }` ]
		);
		tmpFiles.push( finalDestination );
	}

	return tmpFiles;
}
