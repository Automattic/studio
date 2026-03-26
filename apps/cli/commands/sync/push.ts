import fs from 'fs';
import { readAuthToken } from '@studio/common/lib/shared-config';
import {
	SYNC_MAX_POLL_ATTEMPTS,
	SYNC_POLL_INTERVAL_MS,
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import { createTusUpload } from '@studio/common/lib/sync/tus-upload';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import {
	fetchSyncableSites,
	initiateImport,
	parseSyncOptions,
	pollImportStatus,
} from 'cli/lib/sync-api';
import { selectSyncItemsForPush } from 'cli/lib/sync-selector';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { SyncOption } from '@studio/common/types/sync';

export async function runCommand(
	siteFolder: string,
	optionsString?: string,
	archivePath?: string
): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}

		const site = await getSiteByFolder( siteFolder );

		if ( ! archivePath ) {
			// TODO: Export local site to tar.gz archive (requires export-manager)
			throw new LoggerError(
				__(
					'Local site export is not yet implemented in CLI. Use --archive to provide an existing archive file.'
				)
			);
		}

		if ( ! fs.existsSync( archivePath ) ) {
			throw new LoggerError( sprintf( __( 'Archive file not found: %s' ), archivePath ) );
		}

		const archiveSize = fs.statSync( archivePath ).size;
		if ( archiveSize > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
			throw new LoggerError(
				sprintf(
					__(
						'The archive exceeds the %d GB size limit. Please reduce the size of your site and try again.'
					),
					SYNC_PUSH_SIZE_LIMIT_GB
				)
			);
		}

		logger.reportStart( LoggerAction.FETCH_SITES, __( 'Fetching WordPress.com sites…' ) );
		const sites = await fetchSyncableSites( token.accessToken );
		logger.spinner.stop();
		logger.reportSuccess( sprintf( __( 'Found %d sites' ), sites.length ), true );

		const selectedSite = await pickSyncSite( sites, __( 'Select a site to push to' ) );
		if ( ! selectedSite ) {
			return;
		}

		let optionsToSync: SyncOption[];
		let specificSelectionPaths: string[] | undefined;

		if ( optionsString ) {
			optionsToSync = parseSyncOptions( optionsString );
		} else {
			const selection = await selectSyncItemsForPush( site.path );
			if ( ! selection ) {
				return;
			}
			optionsToSync = selection.optionsToSync;
			specificSelectionPaths = selection.specificSelectionPaths;
		}

		const remoteSiteId = selectedSite.id;
		const remoteSiteName = selectedSite.name;
		const remoteSiteUrl = selectedSite.url;

		// Push progress: Export (0-20%) → Upload (20-40%) → Remote backup (40-60%) → Import (60-99%) → Done (100%)
		// Export phase skipped when using --archive, so upload starts at 20%

		// Suppress DEP0169 warning from tus-js-client's internal use of url.parse()
		const originalEmit = process.emit.bind( process );
		// @ts-expect-error Overriding process.emit to filter deprecation warnings
		process.emit = ( event: string, ...args: unknown[] ) => {
			if ( event === 'warning' && ( args[ 0 ] as { code?: string } )?.code === 'DEP0169' ) {
				return false;
			}
			return ( originalEmit as ( ...a: any[] ) => boolean )( event, ...args );
		};

		logger.reportStart( LoggerAction.UPLOAD, sprintf( __( 'Uploading archive… (%d%%)' ), 20 ) );
		const { promise: uploadPromise, abort: abortUpload } = createTusUpload( {
			token: token.accessToken,
			remoteSiteId,
			archivePath,
			onProgress: ( percent ) => {
				// Upload phase: 20-40%
				const progress = Math.round( 20 + percent * 0.2 );
				logger.spinner.text = sprintf( __( 'Uploading archive… (%d%%)' ), progress );
			},
		} );

		const onSigint = () => {
			abortUpload();
			logger.spinner.stop();
			logger.reportError( new LoggerError( __( 'Upload cancelled' ) ) );
		};
		process.once( 'SIGINT', onSigint );

		let attachmentId: string;
		try {
			attachmentId = await uploadPromise;
		} finally {
			process.removeListener( 'SIGINT', onSigint );
			process.emit = originalEmit;
		}

		// Initiate import: 40%
		logger.spinner.text = sprintf( __( 'Initiating import… (%d%%)' ), 40 );
		await initiateImport( token.accessToken, remoteSiteId, attachmentId, {
			optionsToSync,
			specificSelectionPaths,
		} );

		// Poll import: 40-99%
		for ( let attempt = 0; attempt < SYNC_MAX_POLL_ATTEMPTS; attempt++ ) {
			const status = await pollImportStatus( token.accessToken, remoteSiteId );

			if ( status.status === 'failed' ) {
				throw new LoggerError( sprintf( __( 'Import failed on %s' ), remoteSiteName ) );
			}

			if ( status.status === 'finished' ) {
				break;
			}

			let statusMessage: string;
			let progress: number;

			switch ( status.status ) {
				case 'started':
				case 'initial_backup_started':
				case 'initial_backup_finished':
					statusMessage = __( 'Backing up remote site…' );
					progress = 40 + ( ( status.backup_progress ?? 0 ) / 100 ) * 20;
					break;
				case 'archive_import_started':
					statusMessage = __( 'Applying changes…' );
					progress = 60 + ( ( status.import_progress ?? 0 ) / 100 ) * 35;
					break;
				case 'archive_import_finished':
					statusMessage = __( 'Almost there…' );
					progress = 99;
					break;
				default:
					statusMessage = __( 'Applying changes…' );
					progress = 50;
			}

			logger.spinner.text = sprintf( '%s (%d%%)', statusMessage, Math.round( progress ) );

			await new Promise( ( resolve ) => setTimeout( resolve, SYNC_POLL_INTERVAL_MS ) );
		}
		logger.spinner.stop();
		logger.reportSuccess(
			sprintf( __( 'Successfully pushed to %s (%s)' ), remoteSiteName, remoteSiteUrl )
		);
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Push failed' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'push',
		describe: __( 'Push your local site to a WordPress.com site' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'options', {
					type: 'string',
					description: __(
						'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents'
					),
				} )
				.option( 'archive', {
					type: 'string',
					description: __( 'Path to an existing tar.gz archive to push (skips local export)' ),
				} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, argv.options, argv.archive );
		},
	} );
};
