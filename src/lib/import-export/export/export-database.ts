import path from 'path';
import { rename } from 'fs-extra';
import { SiteServer } from '../../../site-server';

export async function exportDatabaseToFile(
	site: SiteDetails,
	finalDestination: string
): Promise< void > {
	const server = SiteServer.get( site.id );

	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	// Generate a temporary file name in the project directory
	const tempFileName = `temp_export_${ Date.now() }.sql`;
	const tempFilePath = path.join( site.path, tempFileName );

	// Execute the command to export directly to the temp file
	const { stderr } = await server.executeWpCliCommand( `db export ${ tempFileName }` );

	if ( stderr ) {
		console.error( 'Error during export:', stderr );
		throw new Error( 'Database export failed' );
	}

	// Move the file to its final destination
	await rename( tempFilePath, finalDestination );

	console.log( `Database export saved to ${ finalDestination }` );
}
