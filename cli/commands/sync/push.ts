import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { __, sprintf } from '@wordpress/i18n';
import wpcomFactory from 'src/lib/wpcom-factory';
import wpcomXhrRequest from 'src/lib/wpcom-xhr-request-factory';
import { Upload } from 'tus-js-client';
import { z } from 'zod';
import {
	getAuthToken,
	lockAppdata,
	readAppdata,
	saveAppdata,
	unlockAppdata,
} from 'cli/lib/appdata';
import { exportSiteToTarGz } from 'cli/lib/sync-export';
import { getSiteForSync } from 'cli/lib/sync-helpers';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const TEMP_DIR = path.join( os.tmpdir(), 'studio-sync-exports' );
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300; // 10 minutes max
const MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

const importStatusSchema = z.object( {
	success: z.boolean(),
	status: z.enum( [
		'initial_backup',
		'archive_import_started',
		'archive_import_finished',
		'finished',
		'failed',
	] ),
	error: z.string().optional(),
	error_data: z
		.object( {
			vp_restore_message: z.string().optional(),
		} )
		.optional(),
} );

type ImportStatus = z.infer< typeof importStatusSchema >;

async function uploadFile(
	token: string,
	remoteSiteId: number,
	filePath: string,
	logger: Logger
): Promise< void > {
	const file = fs.createReadStream( filePath );
	const fileSize = fs.statSync( filePath ).size;

	if ( fileSize > MAX_SIZE_BYTES ) {
		throw new Error( sprintf( __( 'File size exceeds 5GB limit (%d bytes)' ), fileSize ) );
	}

	return new Promise( ( resolve, reject ) => {
		let lastProgress = 0;

		const upload = new Upload( file, {
			endpoint: `https://public-api.wordpress.com/rest/v1.1/studio-file-uploads/${ remoteSiteId }`,
			chunkSize: 500000,
			retryDelays: [ 0, 1000, 3000, 5000, 10000, 25000 ],
			overridePatchMethod: true,
			removeFingerprintOnSuccess: true,
			storeFingerprintForResuming: true,
			headers: {
				Authorization: `Bearer ${ token }`,
			},
			metadata: {
				filename: path.basename( filePath ),
				filetype: 'application/gzip',
			},
			onError: ( error ) => {
				reject( error );
			},
			onProgress: ( bytesUploaded, bytesTotal ) => {
				const progress = Math.floor( ( bytesUploaded / bytesTotal ) * 100 );
				if ( progress > lastProgress && progress % 5 === 0 ) {
					logger.reportProgress( sprintf( __( 'Uploading… %d%%' ), progress ) );
					lastProgress = progress;
				}
			},
			onSuccess: () => {
				resolve();
			},
		} );

		upload.start();
	} );
}

async function initiateImport(
	token: string,
	remoteSiteId: number,
	options: string[]
): Promise< void > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	return new Promise( ( resolve, reject ) => {
		wpcom.req.post(
			{
				path: `/sites/${ remoteSiteId }/studio-app/sync/import/initiate`,
				apiNamespace: 'wpcom/v2',
				body: {
					options,
					paths: [],
				},
			},
			( error: Error | null, data: unknown ) => {
				if ( error ) {
					return reject( error );
				}

				try {
					const result = z.object( { success: z.boolean() } ).parse( data );
					if ( ! result.success ) {
						return reject( new Error( __( 'Failed to initiate import' ) ) );
					}
					resolve();
				} catch ( validationError ) {
					reject( validationError );
				}
			}
		);
	} );
}

async function checkImportStatus( token: string, remoteSiteId: number ): Promise< ImportStatus > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	return new Promise( ( resolve, reject ) => {
		void wpcom.req.get(
			{
				path: `/sites/${ remoteSiteId }/studio-app/sync/import`,
				apiNamespace: 'wpcom/v2',
			},
			( error: Error | null, data: unknown ) => {
				if ( error ) {
					return reject( error );
				}

				try {
					const result = importStatusSchema.parse( data );
					resolve( result );
				} catch ( validationError ) {
					reject( validationError );
				}
			}
		);
	} );
}

export async function runCommand( localSiteId?: string, options?: string[] ): Promise< void > {
	const logger = new Logger();
	let archivePath: string | null = null;

	try {
		// Get auth token
		let token: Awaited< ReturnType< typeof getAuthToken > >;
		try {
			token = await getAuthToken();
		} catch {
			logger.reportError(
				new LoggerError(
					__(
						'Authentication required. Please log in to WordPress.com first:\n\n  studio auth login'
					)
				)
			);
			return;
		}

		// Get the local site
		const localSite = await getSiteForSync( localSiteId );

		// Load appdata
		const appdata = await readAppdata();

		// Find connected site
		const connectedSites = appdata.connectedWpcomSites?.[ token.id ] || [];
		const syncSite = connectedSites.find( ( site ) => site.localSiteId === localSite.id );

		if ( ! syncSite ) {
			logger.reportError(
				new LoggerError(
					sprintf(
						__( 'Site "%s" is not connected to WordPress.com' ),
						localSite.name || localSite.id
					)
				)
			);
			console.log( __( '\nUse "studio sync connect" to connect to a remote site' ) );
			return;
		}

		// Create temporary directory
		await fsPromises.mkdir( TEMP_DIR, { recursive: true } );

		// Export local site
		logger.reportStart( undefined, __( 'Exporting local site…' ) );

		archivePath = path.join( TEMP_DIR, `site_${ localSite.id }.tar.gz` );

		const optionsArray = options || [ 'all' ];
		const shouldIncludeOption = ( option: string ): boolean => {
			return optionsArray.includes( option ) || optionsArray.includes( 'all' );
		};

		await exportSiteToTarGz(
			localSite,
			archivePath,
			{
				includeDatabase: shouldIncludeOption( 'sqls' ),
				includeWpContent:
					shouldIncludeOption( 'uploads' ) ||
					shouldIncludeOption( 'plugins' ) ||
					shouldIncludeOption( 'themes' ) ||
					shouldIncludeOption( 'contents' ) ||
					optionsArray.includes( 'all' ),
				specificPaths: undefined,
			},
			logger
		);

		// Check file size
		const stats = fs.statSync( archivePath );
		if ( stats.size > MAX_SIZE_BYTES ) {
			throw new Error(
				__(
					'Exported site exceeds 5GB limit. Please reduce the site size or select specific content to sync.'
				)
			);
		}

		// Upload to WordPress.com
		logger.reportProgress( __( 'Uploading to WordPress.com…' ) );
		await uploadFile( token.accessToken, syncSite.id, archivePath, logger );

		// Initiate import
		logger.reportProgress( __( 'Initiating import on remote site…' ) );
		await initiateImport( token.accessToken, syncSite.id, optionsArray );

		// Poll for import completion
		logger.reportProgress( __( 'Waiting for import to complete…' ) );
		let attempts = 0;
		let status: ImportStatus | null = null;

		while ( attempts < MAX_POLL_ATTEMPTS ) {
			await new Promise( ( resolve ) => setTimeout( resolve, POLL_INTERVAL_MS ) );
			status = await checkImportStatus( token.accessToken, syncSite.id );

			if ( status.status === 'finished' ) {
				break;
			}

			if ( status.status === 'failed' ) {
				const restoreMessage = status.error_data?.vp_restore_message || '';
				const isSqlImportFailure = /importing sql dump/i.test( restoreMessage );
				const isImportTimedOut = status.error === 'Import timed out';

				if ( isSqlImportFailure ) {
					throw new Error(
						__(
							'Database import failed on the remote site. Please review your database and try again.'
						)
					);
				} else if ( isImportTimedOut ) {
					throw new Error(
						__(
							"A timeout error occurred while pushing the site, likely due to its large size. Please try reducing the site's content or files and try again."
						)
					);
				} else {
					throw new Error( status.error || __( 'Import failed' ) );
				}
			}

			attempts++;
			if ( attempts % 10 === 0 ) {
				const statusMap: Record< string, string > = {
					initial_backup: __( 'Creating backup…' ),
					archive_import_started: __( 'Importing…' ),
					archive_import_finished: __( 'Finalizing…' ),
				};
				const statusText = statusMap[ status.status ] || __( 'Processing…' );
				logger.reportProgress( sprintf( __( '%s (%d seconds)' ), statusText, attempts * 2 ) );
			}
		}

		if ( ! status || status.status !== 'finished' ) {
			throw new Error( __( 'Import timed out' ) );
		}

		// Cleanup
		if ( archivePath ) {
			await fsPromises.unlink( archivePath ).catch( () => {} );
		}

		// Update last push timestamp
		await lockAppdata();
		try {
			const updatedAppdata = await readAppdata();
			const updatedConnectedSites = updatedAppdata.connectedWpcomSites?.[ token.id ] || [];
			const siteIndex = updatedConnectedSites.findIndex(
				( site ) => site.id === syncSite.id && site.localSiteId === localSite.id
			);

			if ( siteIndex !== -1 ) {
				updatedConnectedSites[ siteIndex ].lastPushTimestamp = new Date().toISOString();
				if ( ! updatedAppdata.connectedWpcomSites ) {
					updatedAppdata.connectedWpcomSites = {};
				}
				updatedAppdata.connectedWpcomSites[ token.id ] = updatedConnectedSites;
				await saveAppdata( updatedAppdata );
			}
		} finally {
			await unlockAppdata();
		}

		logger.reportSuccess(
			sprintf(
				__( 'Successfully pushed "%s" to "%s"' ),
				localSite.name || localSite.id,
				syncSite.name
			)
		);
	} catch ( error ) {
		logger.spinner.stop();

		// Cleanup on error
		if ( archivePath ) {
			await fsPromises.unlink( archivePath ).catch( () => {} );
		}

		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else if ( error instanceof z.ZodError ) {
			logger.reportError( new LoggerError( __( 'Invalid response from server' ), error ) );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to push site' ), error ) );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'push [local-site-id]',
		describe: __( 'Push changes from local site to WordPress.com' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'local-site-id', {
					describe: __( 'ID of the local site (optional if run from site directory)' ),
					type: 'string',
				} )
				.option( 'options', {
					describe: __( 'What to sync (all, sqls, themes, plugins, uploads, contents)' ),
					type: 'array',
					default: [ 'all' ],
				} )
				.option( 'path', {
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			await runCommand(
				argv[ 'local-site-id' ] as string | undefined,
				argv.options as string[] | undefined
			);
		},
	} );
};
