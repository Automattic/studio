import { __, sprintf } from '@wordpress/i18n';
import fs from 'fs';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { importBackupFromFile } from 'cli/lib/sync-import';
import { getSiteForSync } from 'cli/lib/sync-helpers';
import wpcomFactory from 'src/lib/wpcom-factory';
import wpcomXhrRequest from 'src/lib/wpcom-xhr-request-factory';
import { z } from 'zod';
import { getAuthToken, lockAppdata, readAppdata, saveAppdata, unlockAppdata } from 'cli/lib/appdata';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const TEMP_DIR = path.join( os.tmpdir(), 'studio-sync-backups' );
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 200; // 10 minutes max

const backupStatusSchema = z.object( {
	success: z.boolean(),
	status: z.enum( [ 'creating', 'ready', 'failed' ] ),
	download_url: z.string().optional(),
	error: z.string().optional(),
} );

type BackupStatus = z.infer< typeof backupStatusSchema >;

async function createBackup(
	token: string,
	remoteSiteId: number,
	options: string[]
): Promise< string > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	return new Promise( ( resolve, reject ) => {
		wpcom.req.post(
			{
				path: `/sites/${ remoteSiteId }/studio-app/sync/backup`,
				apiNamespace: 'wpcom/v2',
				body: {
					options,
					include_path_list: [],
				},
			},
			( error: Error | null, data: unknown ) => {
				if ( error ) {
					return reject( error );
				}

				try {
					const result = z.object( { success: z.boolean(), backup_id: z.string() } ).parse( data );
					if ( ! result.success ) {
						return reject( new Error( __( 'Failed to create backup' ) ) );
					}
					resolve( result.backup_id );
				} catch ( validationError ) {
					reject( validationError );
				}
			}
		);
	} );
}

async function checkBackupStatus(
	token: string,
	remoteSiteId: number,
	backupId: string
): Promise< BackupStatus > {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	return new Promise( ( resolve, reject ) => {
		wpcom.req.get(
			{
				path: `/sites/${ remoteSiteId }/studio-app/sync/backup`,
				apiNamespace: 'wpcom/v2',
			},
			{ backup_id: backupId },
			( error: Error | null, data: unknown ) => {
				if ( error ) {
					return reject( error );
				}

				try {
					const result = backupStatusSchema.parse( data );
					resolve( result );
				} catch ( validationError ) {
					reject( validationError );
				}
			}
		);
	} );
}

async function downloadFile( url: string, dest: string, logger: Logger ): Promise< void > {
	const https = await import( 'https' );
	const file = fs.createWriteStream( dest );

	return new Promise( ( resolve, reject ) => {
		https.get( url, ( response ) => {
			if ( response.statusCode !== 200 ) {
				reject( new Error( `Failed to download: ${ response.statusCode }` ) );
				return;
			}

			const totalSize = parseInt( response.headers[ 'content-length' ] || '0', 10 );
			let downloadedSize = 0;
			let lastProgress = 0;

			response.on( 'data', ( chunk ) => {
				downloadedSize += chunk.length;
				const progress = Math.floor( ( downloadedSize / totalSize ) * 100 );

				if ( progress > lastProgress && progress % 10 === 0 ) {
					logger.reportProgress(
						sprintf( __( 'Downloading backup… %d%%' ), progress )
					);
					lastProgress = progress;
				}
			} );

			response.pipe( file );

			file.on( 'finish', () => {
				file.close();
				resolve();
			} );

			file.on( 'error', ( err ) => {
				fs.unlink( dest, () => {} );
				reject( err );
			} );
		} );
	} );
}

export async function runCommand( localSiteId?: string, options?: string[] ): Promise< void > {
	const logger = new Logger();

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
					sprintf( __( 'Site "%s" is not connected to WordPress.com' ), localSite.name || localSite.id )
				)
			);
			console.log( __( '\nUse "studio sync connect" to connect to a remote site' ) );
			return;
		}

		// Create temporary directory
		await fsPromises.mkdir( TEMP_DIR, { recursive: true } );

		// Start backup creation
		logger.reportStart( undefined, __( 'Creating backup on remote site…' ) );
		const backupId = await createBackup( token.accessToken, syncSite.id, options || [ 'all' ] );

		// Poll for backup completion
		logger.reportProgress( __( 'Waiting for backup to complete…' ) );
		let attempts = 0;
		let status: BackupStatus | null = null;

		while ( attempts < MAX_POLL_ATTEMPTS ) {
			await new Promise( ( resolve ) => setTimeout( resolve, POLL_INTERVAL_MS ) );
			status = await checkBackupStatus( token.accessToken, syncSite.id, backupId );

			if ( status.status === 'ready' ) {
				break;
			}

			if ( status.status === 'failed' ) {
				throw new Error( status.error || __( 'Backup creation failed' ) );
			}

			attempts++;
			if ( attempts % 5 === 0 ) {
				logger.reportProgress(
					sprintf( __( 'Waiting for backup… (%d seconds)' ), attempts * 3 )
				);
			}
		}

		if ( ! status || status.status !== 'ready' || ! status.download_url ) {
			throw new Error( __( 'Backup timed out or failed' ) );
		}

		// Download backup
		logger.reportProgress( __( 'Downloading backup…' ) );
		const backupPath = path.join( TEMP_DIR, `backup-${ syncSite.id }.tar.gz` );
		await downloadFile( status.download_url, backupPath, logger );

		// Import backup
		logger.reportProgress( __( 'Importing backup into local site…' ) );

		await importBackupFromFile( backupPath, localSite, logger );

		// Cleanup
		await fsPromises.unlink( backupPath ).catch( () => {} );

		// Update last pull timestamp
		await lockAppdata();
		try {
			const updatedAppdata = await readAppdata();
			const updatedConnectedSites = updatedAppdata.connectedWpcomSites?.[ token.id ] || [];
			const siteIndex = updatedConnectedSites.findIndex(
				( site ) => site.id === syncSite.id && site.localSiteId === localSite.id
			);

			if ( siteIndex !== -1 ) {
				updatedConnectedSites[ siteIndex ].lastPullTimestamp = new Date().toISOString();
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
				__( 'Successfully pulled from "%s" to "%s"' ),
				syncSite.name,
				localSite.name || localSite.id
			)
		);
	} catch ( error ) {
		logger.spinner.stop();
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else if ( error instanceof z.ZodError ) {
			logger.reportError( new LoggerError( __( 'Invalid response from server' ), error ) );
		} else {
			logger.reportError( new LoggerError( __( 'Failed to pull site' ), error ) );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'pull [local-site-id]',
		describe: __( 'Pull changes from WordPress.com to local site' ),
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
			await runCommand( argv[ 'local-site-id' ] as string | undefined, argv.options as string[] | undefined );
		},
	} );
};
