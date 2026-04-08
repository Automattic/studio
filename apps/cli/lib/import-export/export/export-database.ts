import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import { move } from 'fs-extra';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { generateBackupFilename } from './generate-backup-filename';

export async function exportDatabaseToFile(
	siteFolder: string,
	finalDestination: string
): Promise< void > {
	// Generate a temporary file name in the project directory
	const tempFileName = `${ generateBackupFilename( 'db-export' ) }.sql`;

	// Execute the command to export directly to the temp file
	// Use absolute path /wordpress/ because that's where site.path is mounted in the WASM filesystem
	await using command = await runWpCliCommand( siteFolder, DEFAULT_PHP_VERSION, [
		'sqlite',
		'export',
		`/wordpress/${ tempFileName }`,
		'--require=/tmp/sqlite-command/command.php',
		'--enable-ast-driver',
		'--skip-plugins',
		'--skip-themes',
	] );

	const exitCode = await command.response.exitCode;
	if ( exitCode !== 0 ) {
		throw new Error( 'Database export failed' );
	}

	// Move the file to its final destination
	const tempFilePath = path.join( siteFolder, tempFileName );
	await move( tempFilePath, finalDestination );
}

export async function exportDatabaseToMultipleFiles(
	siteFolder: string,
	finalDestinationDir: string
): Promise< string[] > {
	await using command = await runWpCliCommand( siteFolder, DEFAULT_PHP_VERSION, [
		'sqlite',
		'tables',
		'--format=json',
		'--require=/tmp/sqlite-command/command.php',
		'--enable-ast-driver',
		'--skip-plugins',
		'--skip-themes',
	] );

	const tablesStdout = await command.response.stdoutText;
	const exitCode = await command.response.exitCode;
	if ( exitCode !== 0 ) {
		throw new Error( 'Database export failed' );
	}

	let tables;

	try {
		tables = parseJsonFromPhpOutput( tablesStdout );
	} catch ( error ) {
		console.error( `Could not get list of database tables. The WP CLI output: ${ tablesStdout }` );
		throw new Error( 'Could not get list of database tables to export.' );
	}

	const tmpFiles: string[] = [];

	for ( const table of tables ) {
		if ( table === 'wp_users' || table === 'wp_usermeta' ) {
			// Skip the wp_users and wp_usermeta tables as they are not needed
			continue;
		}

		const fileName = `${ table }.sql`;

		// Execute the command to export directly to a temporary file in the project directory
		await using command = await runWpCliCommand( siteFolder, DEFAULT_PHP_VERSION, [
			'sqlite',
			'export',
			// Use absolute path /wordpress/ because that's where site.path is mounted in the WASM filesystem
			`/wordpress/${ fileName }`,
			`--tables=${ table }`,
			'--require=/tmp/sqlite-command/command.php',
			'--enable-ast-driver',
			'--skip-plugins',
			'--skip-themes',
		] );

		const exitCode = await command.response.exitCode;
		if ( exitCode !== 0 ) {
			throw new Error( `Database export failed for table ${ table }` );
		}

		// Move the file to its final destination
		const tempFilePath = path.join( siteFolder, fileName );
		const finalDestination = path.join( finalDestinationDir, fileName );
		await move( tempFilePath, finalDestination );

		tmpFiles.push( finalDestination );
	}

	return tmpFiles;
}
