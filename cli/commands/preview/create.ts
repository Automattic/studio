import fs from 'fs';
import https from 'https';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import fetch from 'node-fetch';
import { Logger } from 'cli/logger';
import { OutputFormat, RegisterCommand } from 'cli/types';

enum LoggerStatus {
	ARCHIVE_CREATING = 'Creating archive...',
	ARCHIVE_CREATED = 'Archive created',
	ARCHIVE_UPLOADING = 'Uploading archive...',
	ARCHIVE_UPLOADED = 'Archive uploaded',
	PREVIEW_SITE_URL = 'Preview site available at:',
	ARCHIVE_DELETED = 'Temporary files cleaned up',
	AUTH_REQUIRED = 'Authentication required. Please run the electron app and authenticate first.',
}

export const registerCommand: RegisterCommand = ( program ) => {
	program
		.command( 'go [folder]' )
		.description(
			'Create a preview site from the specified folder (defaults to current directory)'
		)
		.action( async ( siteFolder: string = process.cwd(), options: { outputFormat?: 'json' } ) => {
			await runCommand( siteFolder, options.outputFormat );
		} );
};

async function runCommand( siteFolder: string, outputFormat: OutputFormat ): Promise< boolean > {
	const archivePath = path.join(
		os.tmpdir(),
		`${ path.basename( siteFolder ) }-${ Date.now() }.zip`
	);
	const logger = new Logger< LoggerStatus >( outputFormat );

	try {
		if ( ! fs.existsSync( siteFolder ) ) {
			throw new Error( `Folder not found: ${ siteFolder }` );
		}

		if ( ! isWordPressDirectory( siteFolder ) && ! hasWpContentDirectory( siteFolder ) ) {
			throw new Error(
				`The specified folder doesn't appear to be a WordPress site. ` +
					`Please ensure it contains a wp-content directory.`
			);
		}

		logger.reportProgress( LoggerStatus.ARCHIVE_CREATING );
		await createArchive( siteFolder, archivePath, logger );

		logger.reportProgress( LoggerStatus.ARCHIVE_UPLOADING );

		// Attempt to get auth token
		const token = await getAuthToken();
		if ( ! token ) {
			logger.reportProgress( LoggerStatus.AUTH_REQUIRED );
			cleanup( archivePath, logger );
			return false;
		}

		const response = await uploadArchive( archivePath, token, logger );

		const { site_url } = response as { site_url?: string };
		if ( site_url ) {
			logger.reportProgress( LoggerStatus.PREVIEW_SITE_URL );
			console.log( site_url );
		}

		cleanup( archivePath, logger );
		return true;
	} catch ( error ) {
		logger.reportError( error instanceof Error ? error.message : 'Unknown error occurred' );
		return false;
	}
}

/**
 * Attempts to read the WordPress.com authentication token from the user data
 * stored by the Electron app.
 *
 * @returns The authentication token or null if not found or can't be read
 */
async function getAuthToken(): Promise< string | null > {
	const homeDir = os.homedir();
	const appDataPath = path.join(
		homeDir,
		'Library',
		'Application Support',
		'Studio',
		'appdata-v1.json'
	);

	if ( ! fs.existsSync( appDataPath ) ) {
		return null;
	}

	try {
		const userData = JSON.parse( fs.readFileSync( appDataPath, 'utf8' ) );
		return userData.authToken?.accessToken || null;
	} catch ( error ) {
		return null;
	}
}

/**
 * Checks if the given path is a WordPress directory.
 *
 * @param projectPath The path to check
 * @returns Whether the path is a WordPress directory
 */
function isWordPressDirectory( projectPath: string ): boolean {
	return (
		fs.existsSync( path.join( projectPath, 'wp-content' ) ) &&
		fs.existsSync( path.join( projectPath, 'wp-includes' ) ) &&
		fs.existsSync( path.join( projectPath, 'wp-load.php' ) )
	);
}

/**
 * Checks if the given path has a wp-content directory.
 *
 * @param projectPath The path to check
 * @returns Whether the path has a wp-content directory
 */
function hasWpContentDirectory( projectPath: string ): boolean {
	return fs.existsSync( path.join( projectPath, 'wp-content' ) );
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

		// Archive site wp-content (matching Electron app approach)
		archive.directory( path.join( siteFolder, 'wp-content' ), 'wp-content' );

		// Include wp-config.php if it exists
		const wpConfigPath = path.join( siteFolder, 'wp-config.php' );
		if ( fs.existsSync( wpConfigPath ) ) {
			archive.file( wpConfigPath, { name: 'wp-config.php' } );
		}

		archive.finalize();
	} );
}

async function uploadArchive(
	archivePath: string,
	token: string,
	logger: Logger< LoggerStatus >
): Promise< unknown > {
	return new Promise( ( resolve, reject ) => {
		// Read the file content
		const fileContent = fs.readFileSync( archivePath );

		// Create a boundary for multipart/form-data
		const boundary = '----WebKitFormBoundary' + Math.random().toString( 16 ).substr( 2 );

		// Start of form data
		let formData = '';
		formData += `--${ boundary }\r\n`;
		formData +=
			'Content-Disposition: form-data; name="import"; filename="local-env-site-1.zip"\r\n';
		formData += 'Content-Type: application/zip\r\n\r\n';

		// End of form data
		const endFormData = `\r\n--${ boundary }--\r\n`;

		// Create the request options
		const options = {
			hostname: 'public-api.wordpress.com',
			path: '/wpcom/v2/jurassic-ninja/create-new-site-from-zip',
			method: 'POST',
			headers: {
				Authorization: `Bearer ${ token }`,
				'Content-Type': `multipart/form-data; boundary=${ boundary }`,
				'Content-Length':
					Buffer.byteLength( formData ) + fileContent.length + Buffer.byteLength( endFormData ),
			},
		};

		// Create the request
		const req = https.request( options, ( res ) => {
			if ( res.statusCode !== 200 ) {
				reject( new Error( `Failed to upload archive: ${ res.statusMessage }` ) );
				return;
			}

			let data = '';
			res.on( 'data', ( chunk ) => {
				data += chunk;
			} );

			res.on( 'end', () => {
				logger.reportProgress( LoggerStatus.ARCHIVE_UPLOADED );
				try {
					const jsonResponse = JSON.parse( data );

					// Check for domain_name (which is the site URL)
					if ( jsonResponse.domain_name ) {
						logger.reportProgress( LoggerStatus.PREVIEW_SITE_URL );
						console.log( `https://${ jsonResponse.domain_name }` );
					}

					resolve( jsonResponse );
				} catch ( e ) {
					reject( new Error( 'Failed to parse response' ) );
				}
			} );
		} );

		req.on( 'error', ( e ) => {
			reject( e );
		} );

		// Write the form data start
		req.write( formData );

		// Write the file content
		req.write( fileContent );

		// Write the form data end
		req.write( endFormData );

		// End the request
		req.end();
	} );
}

function cleanup( archivePath: string, logger: Logger< LoggerStatus > ): void {
	if ( fs.existsSync( archivePath ) ) {
		fs.unlinkSync( archivePath );
		logger.reportProgress( LoggerStatus.ARCHIVE_DELETED );
	}
}
