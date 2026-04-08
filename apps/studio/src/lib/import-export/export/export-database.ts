import path from 'path';
import { parseJsonFromPhpOutput } from '@studio/common/lib/php-output-parser';
import { move } from 'fs-extra';
import { generateBackupFilename } from 'src/lib/import-export/export/generate-backup-filename';
import { SiteServer } from 'src/site-server';

/**
 * Filter PHP deprecation and notice messages from stderr output.
 * These are harmless in the context of WP-CLI commands and should not
 * cause the export to fail (e.g. deprecations in bundled phar dependencies).
 */
function filterPhpNonFatalMessages( stderr: string ): string {
	return stderr
		.split( '\n' )
		.filter( ( line ) => ! /^PHP (Deprecated|Notice|Warning):/.test( line ) )
		.join( '\n' )
		.trim();
}

export async function exportDatabaseToFile(
	site: SiteDetails,
	finalDestination: string
): Promise< void > {
	const server = SiteServer.get( site.id );

	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	// Generate a temporary file name in the project directory
	const tempFileName = `${ generateBackupFilename( 'db-export' ) }.sql`;

	// Execute the command to export directly to the temp file
	// Use absolute path /wordpress/ because that's where site.path is mounted in the WASM filesystem
	const vfsFilePath = `/wordpress/${ tempFileName }`;
	const { stderr, exitCode } = await server.executeWpCliCommand(
		`sqlite export ${ vfsFilePath } --require=/tmp/sqlite-command/command.php --enable-ast-driver`,
		{
			skipPluginsAndThemes: true,
		}
	);

	const filteredStderr = filterPhpNonFatalMessages( stderr );
	if ( filteredStderr ) {
		throw new Error( `Database export failed: ${ filteredStderr }` );
	}

	if ( exitCode ) {
		throw new Error( 'Database export failed' );
	}

	// Move the file to its final destination
	const tempFilePath = path.join( site.path, tempFileName );
	await move( tempFilePath, finalDestination );

	console.log( `Database export saved to ${ finalDestination }` );
}

export async function exportDatabaseToMultipleFiles(
	site: SiteDetails,
	finalDestinationDir: string
): Promise< string[] > {
	const server = SiteServer.get( site.id );

	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	const tablesResult = await server.executeWpCliCommand(
		`sqlite tables --format=json --require=/tmp/sqlite-command/command.php --enable-ast-driver`,
		{
			skipPluginsAndThemes: true,
		}
	);
	const filteredTablesStderr = filterPhpNonFatalMessages( tablesResult.stderr );
	if ( filteredTablesStderr ) {
		throw new Error( `Database export failed: ${ filteredTablesStderr }` );
	}
	if ( tablesResult.exitCode ) {
		throw new Error( 'Database export failed' );
	}

	let tables;

	try {
		tables = parseJsonFromPhpOutput( tablesResult.stdout );
	} catch ( error ) {
		console.error(
			`Could not get list of database tables. The WP CLI output: ${ tablesResult.stdout }`
		);
		throw new Error( 'Could not get list of database tables to export.' );
	}

	const tmpFiles: string[] = [];

	for ( const table of tables ) {
		if ( table === 'wp_users' || table === 'wp_usermeta' ) {
			// Skip the wp_users and wp_usermeta tables as they are not needed
			continue;
		}

		const fileName = `${ table }.sql`;
		// Use absolute path /wordpress/ because that's where site.path is mounted in the WASM filesystem
		const vfsFilePath = `/wordpress/${ fileName }`;

		// Execute the command to export directly to a temporary file in the project directory
		const { stderr, exitCode } = await server.executeWpCliCommand(
			`sqlite export ${ vfsFilePath } --tables=${ table } --require=/tmp/sqlite-command/command.php --enable-ast-driver`,
			{
				skipPluginsAndThemes: true,
			}
		);

		const filteredTableStderr = filterPhpNonFatalMessages( stderr );
		if ( filteredTableStderr ) {
			throw new Error( `Database export failed: ${ filteredTableStderr }` );
		}

		if ( exitCode ) {
			throw new Error( 'Database export failed' );
		}

		// Move the file to its final destination
		const tempFilePath = path.join( site.path, fileName );
		const finalDestination = path.join( finalDestinationDir, fileName );
		await move( tempFilePath, finalDestination );

		tmpFiles.push( finalDestination );
	}

	console.log( `Database export saved to ${ finalDestinationDir }` );

	return tmpFiles;
}
