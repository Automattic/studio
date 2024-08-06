import path from 'path';
import { rename } from 'fs-extra';
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
	const tempFilePath = path.join( site.path, tempFileName );

	// Execute the command to export directly to the temp file
	const { stderr, exitCode } = await server.executeWpCliCommand(
		`sqlite export ${ tempFileName } --require=/tmp/sqlite-command/command.php`
	);

	if ( stderr ) {
		console.error( 'Error during export:', stderr );
		throw new Error( `Database export failed: ${ stderr }` );
	}

	if ( exitCode ) {
		throw new Error( 'Database export failed' );
	}

	// Move the file to its final destination
	await rename( tempFilePath, finalDestination );

	console.log( `Database export saved to ${ finalDestination }` );
}
