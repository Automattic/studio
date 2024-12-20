import path from 'path';
import { move } from 'fs-extra';
import { SiteServer } from '../../../site-server';
import { generateBackupFilename } from './generate-backup-filename';

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
	const { stderr, exitCode } = await server.executeWpCliCommand(
		`sqlite export ${ tempFileName } --require=/tmp/sqlite-command/command.php`,
		{
			skipPluginsAndThemes: true,
		}
	);

	if ( stderr ) {
		throw new Error( `Database export failed: ${ stderr }` );
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
		`sqlite tables --format=json --require=/tmp/sqlite-command/command.php`,
		{
			skipPluginsAndThemes: true,
		}
	);
	if ( tablesResult.stderr ) {
		throw new Error( `Database export failed: ${ tablesResult.stderr }` );
	}
	if ( tablesResult.exitCode ) {
		throw new Error( 'Database export failed' );
	}

	let tables;

	try {
		tables = JSON.parse( tablesResult.stdout );
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

		// Execute the command to export directly to a temporary file in the project directory
		const { stderr, exitCode } = await server.executeWpCliCommand(
			`sqlite export ${ fileName } --tables=${ table } --require=/tmp/sqlite-command/command.php`,
			{
				skipPluginsAndThemes: true,
			}
		);

		if ( stderr ) {
			throw new Error( `Database export failed: ${ stderr }` );
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
