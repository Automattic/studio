import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import fetch from 'node-fetch';
import { Logger } from 'cli/logger';
import { OutputFormat, RegisterCommand } from 'cli/types';

enum LoggerStatus {
	ARCHIVE_CREATED = 'ARCHIVE_CREATED',
	ARCHIVE_UPLOADED = 'ARCHIVE_UPLOADED',
	ARCHIVE_DELETED = 'ARCHIVE_DELETED',
}

// This is DUMMY code for now. It's only meant as a reference for the actual implementation.
export const registerCommand: RegisterCommand = ( program ) => {
	program
		.command( 'go [folder]' )
		.description(
			'Start a new WordPress environment in the specified folder (defaults to current directory)'
		)
		.action( async ( siteFolder: string = process.cwd(), options: { outputFormat?: 'json' } ) => {
			await runCommand( siteFolder, options.outputFormat );
		} );
};

async function runCommand( siteFolder: string, outputFormat: OutputFormat ): Promise< boolean > {
	const archivePath = path.join( os.tmpdir(), `${ siteFolder }.zip` );
	const logger = new Logger< LoggerStatus >( outputFormat );

	try {
		await createArchive( siteFolder, archivePath, logger );
		await uploadArchive( archivePath, logger );
		cleanup( archivePath );
		return true;
	} catch ( error ) {
		logger.reportError( error instanceof Error ? error.message : 'Unknown error occurred' );
		return false;
	}
}

async function createArchive(
	siteFolder: string,
	archivePath: string,
	logger: Logger< LoggerStatus >
): Promise< archiver.Archiver > {
	return new Promise( ( resolve, reject ) => {
		const output = fs.createWriteStream( archivePath );

		const archive = archiver( 'zip', {
			zlib: { level: 9 },
		} );

		output.on( 'close', () => {
			logger.reportProgress( LoggerStatus.ARCHIVE_CREATED );
			resolve( archive );
		} );

		archive.on( 'error', ( err: Error ) => {
			logger.reportError( err.message );
			reject( err );
		} );

		archive.pipe( output );
		archive.directory( `${ siteFolder }/wp-content`, 'wp-content' );
		archive.file( `${ siteFolder }/wp-config.php`, { name: 'wp-config.php' } );

		archive.finalize();
	} );
}

async function uploadArchive(
	archivePath: string,
	logger: Logger< LoggerStatus >
): Promise< unknown > {
	const response = await fetch(
		'https://public-api.wordpress.com/rest/v1.1/jurassic-ninja/create-new-site-from-zip',
		{
			method: 'POST',
			body: fs.createReadStream( archivePath ),
		}
	);
	logger.reportProgress( LoggerStatus.ARCHIVE_UPLOADED );
	return response.json();
}

function cleanup( archivePath: string ): void {
	fs.unlinkSync( archivePath );
}
