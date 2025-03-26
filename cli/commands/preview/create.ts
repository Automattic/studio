import fs from 'fs';
import os from 'os';
import path from 'path';
import archiver from 'archiver';
import WPCOM from 'wpcom';
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
	SITE_CREATING = 'Creating preview site...',
	SITE_READY = 'Preview site is ready',
}

interface CreateSiteResponse {
	domain_name: string;
	atomic_site_id: number;
}

interface StatusResponse {
	status: string;
	domain_name: string;
	atomic_site_id: number;
	is_deleted: string;
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

		logger.reportProgress( { status: LoggerStatus.ARCHIVE_CREATING } );
		await createArchive( siteFolder, archivePath, logger );

		logger.reportProgress( { status: LoggerStatus.ARCHIVE_UPLOADING } );

		const token = await getAuthToken();
		if ( ! token ) {
			logger.reportProgress( { status: LoggerStatus.AUTH_REQUIRED } );
			cleanup( archivePath, logger );
			return false;
		}

		const response = await uploadArchive( archivePath, token, logger );
		const { site_url, site_id } = response;

		if ( site_url && site_id ) {
			await waitForSiteReady( site_id, token, logger );
			logger.reportProgress( { status: LoggerStatus.PREVIEW_SITE_URL, args: { url: site_url } } );
		}

		cleanup( archivePath, logger );
		return true;
	} catch ( error ) {
		logger.reportError( error instanceof Error ? error.message : 'Unknown error occurred' );
		return false;
	}
}

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

function isWordPressDirectory( projectPath: string ): boolean {
	return (
		fs.existsSync( path.join( projectPath, 'wp-content' ) ) &&
		fs.existsSync( path.join( projectPath, 'wp-includes' ) ) &&
		fs.existsSync( path.join( projectPath, 'wp-load.php' ) )
	);
}

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
			logger.reportProgress( { status: LoggerStatus.ARCHIVE_CREATED } );
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
): Promise< { site_url?: string; site_id?: number } > {
	const wpcom = new WPCOM( token );
	const formData = [
		[
			'import',
			fs.createReadStream( archivePath ),
			{
				filename: 'local-env-site-1.zip',
				contentType: 'application/zip',
			},
		],
	];

	try {
		const response = await wpcom.req.post< CreateSiteResponse >( {
			path: '/jurassic-ninja/create-new-site-from-zip',
			apiNamespace: 'wpcom/v2',
			formData,
		} );

		logger.reportProgress( { status: LoggerStatus.ARCHIVE_UPLOADED } );
		return {
			site_url: response.domain_name,
			site_id: response.atomic_site_id,
		};
	} catch ( error: unknown ) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
		throw new Error( `Failed to upload archive: ${ errorMessage }` );
	}
}

function cleanup( archivePath: string, logger: Logger< LoggerStatus > ): void {
	if ( fs.existsSync( archivePath ) ) {
		fs.unlinkSync( archivePath );
		logger.reportProgress( { status: LoggerStatus.ARCHIVE_DELETED } );
	}
}

enum SnapshotStatus {
	Pending = '0',
	Processing = '1',
	Active = '2',
}

async function checkSiteStatus(
	siteId: number,
	token: string,
	logger: Logger< LoggerStatus >
): Promise< boolean > {
	const wpcom = new WPCOM( token );

	try {
		const response = await wpcom.req.get< StatusResponse >( '/jurassic-ninja/status', {
			apiNamespace: 'wpcom/v2',
			site_id: siteId,
		} );

		logger.reportProgress( {
			status: LoggerStatus.SITE_CREATING,
			args: {
				status: response.status,
				site_id: siteId,
				response: JSON.stringify( response ),
				url: response.domain_name,
			},
		} );

		if ( response.status === SnapshotStatus.Active ) {
			logger.reportProgress( { status: LoggerStatus.SITE_READY } );
			return true;
		}
		return false;
	} catch ( error: unknown ) {
		const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
		logger.reportError( `Status check failed: ${ errorMessage }` );
		return false;
	}
}

async function waitForSiteReady(
	siteId: number,
	token: string,
	logger: Logger< LoggerStatus >
): Promise< void > {
	logger.reportProgress( {
		status: LoggerStatus.SITE_CREATING,
		args: { message: 'Starting to wait for site to be ready', site_id: siteId },
	} );

	// Poll every 3 seconds for up to 5 minutes
	const maxAttempts = 100;
	let attempts = 0;

	while ( attempts < maxAttempts ) {
		const isReady = await checkSiteStatus( siteId, token, logger );
		if ( isReady ) {
			return;
		}
		logger.reportProgress( {
			status: LoggerStatus.SITE_CREATING,
			args: {
				message: 'Site not ready yet, waiting 3 seconds...',
				attempt: attempts + 1,
				max_attempts: maxAttempts,
			},
		} );
		await new Promise( ( resolve ) => setTimeout( resolve, 3000 ) );
		attempts++;
	}

	throw new Error( 'Timeout waiting for preview site to be ready' );
}
