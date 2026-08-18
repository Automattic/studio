import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { generateBackupFilename } from '@studio/common/lib/generate-backup-filename';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import { __, sprintf } from '@wordpress/i18n';
import { move } from 'fs-extra';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { LoggerError } from 'cli/logger';
import type { SiteData } from 'cli/lib/cli-config/core';

export async function exportDatabaseToFile(
	site: SiteData,
	finalDestination: string
): Promise< void > {
	// Generate a temporary file name in the project directory
	const tempFileName = `${ generateBackupFilename( 'db-export' ) }.sql`;

	// Execute the command to export directly to a temp file in the site directory (cwd).
	await using command = await runWpCliCommand(
		site,
		[ 'sqlite', 'export', tempFileName, '--enable-ast-driver', '--skip-plugins', '--skip-themes' ],
		{
			requireSqliteCliCommand: true,
			phpVersion: DEFAULT_PHP_VERSION,
		}
	);

	const exitCode = await command.response.exitCode;
	if ( exitCode !== 0 ) {
		throw new LoggerError( __( 'Database export failed' ), undefined, 'database_export' );
	}

	// Move the file to its final destination
	const tempFilePath = path.join( site.path, tempFileName );
	await move( tempFilePath, finalDestination );
}

export async function exportDatabaseToMultipleFiles(
	site: SiteData,
	finalDestinationDir: string
): Promise< string[] > {
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
		throw new LoggerError( __( 'Database export failed' ), undefined, 'database_export' );
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

	const tmpFiles: string[] = [];

	for ( const table of tables ) {
		if ( table === 'wp_users' || table === 'wp_usermeta' ) {
			// Skip the wp_users and wp_usermeta tables as they are not needed
			continue;
		}

		const fileName = `${ table }.sql`;

		// Execute the command to export directly to a temporary file in the project directory
		await using command = await runWpCliCommand(
			site,
			[
				'sqlite',
				'export',
				fileName,
				`--tables=${ table }`,
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
			throw new LoggerError(
				sprintf( __( 'Database export failed for table %s' ), table ),
				undefined,
				'database_export'
			);
		}

		// Move the file to its final destination
		const tempFilePath = path.join( site.path, fileName );
		const finalDestination = path.join( finalDestinationDir, fileName );
		await move( tempFilePath, finalDestination );

		tmpFiles.push( finalDestination );
	}

	return tmpFiles;
}
