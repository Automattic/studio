import fs from 'fs';
import { SYNC_EVENTS } from '@studio/common/lib/cli-events';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { createTusUpload } from '@studio/common/lib/sync/tus-upload';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { fetchSyncableSites, initiateImport, pollImportStatus } from 'cli/lib/sync-api';
import { selectSyncItemsForPush } from 'cli/lib/sync-selector';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { SyncOption } from '@studio/common/types/sync';

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 200;

const VALID_OPTIONS: SyncOption[] = [ 'all', 'sqls', 'uploads', 'plugins', 'themes', 'contents' ];

function parseOptions( optionsString?: string ): SyncOption[] {
	if ( ! optionsString ) {
		return [ 'all' ];
	}

	const options = optionsString.split( ',' ).map( ( o ) => o.trim() ) as SyncOption[];
	for ( const option of options ) {
		if ( ! VALID_OPTIONS.includes( option ) ) {
			throw new LoggerError(
				sprintf(
					__( 'Invalid sync option: %s. Valid options: %s' ),
					option,
					VALID_OPTIONS.join( ', ' )
				)
			);
		}
	}

	return options;
}

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
			optionsToSync = parseOptions( optionsString );
		} else {
			const selection = await selectSyncItemsForPush( site.path );
			if ( ! selection ) {
				return;
			}
			optionsToSync = selection.optionsToSync;
			specificSelectionPaths = selection.specificSelectionPaths;
		}

		void emitCliEvent( {
			event: SYNC_EVENTS.STARTED,
			data: {
				event: SYNC_EVENTS.STARTED,
				type: 'push',
				localSiteId: site.id,
				remoteSiteId: selectedSite.id,
				remoteSiteName: selectedSite.name,
			},
		} );

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
			remoteSiteId: selectedSite.id,
			archivePath,
			onProgress: ( percent ) => {
				// Upload phase: 20-40%
				const progress = Math.round( 20 + percent * 0.2 );
				logger.spinner.text = sprintf( __( 'Uploading archive… (%d%%)' ), progress );

				void emitCliEvent( {
					event: SYNC_EVENTS.PROGRESS,
					data: {
						event: SYNC_EVENTS.PROGRESS,
						type: 'push',
						localSiteId: site.id,
						remoteSiteId: selectedSite.id,
						remoteSiteName: selectedSite.name,
						progress,
						statusMessage: __( 'Uploading…' ),
					},
				} );
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
		}

		process.emit = originalEmit;

		// Initiate import: 40%
		logger.spinner.text = sprintf( __( 'Initiating import… (%d%%)' ), 40 );
		await initiateImport( token.accessToken, selectedSite.id, attachmentId, {
			optionsToSync,
			specificSelectionPaths,
		} );

		// Poll import: 40-99%
		for ( let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++ ) {
			const status = await pollImportStatus( token.accessToken, selectedSite.id );

			if ( status.status === 'failed' ) {
				throw new LoggerError( sprintf( __( 'Import failed on %s' ), selectedSite.name ) );
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

			await new Promise( ( resolve ) => setTimeout( resolve, POLL_INTERVAL_MS ) );
		}
		logger.spinner.stop();
		logger.reportSuccess(
			sprintf( __( 'Successfully pushed to %s (%s)' ), selectedSite.name, selectedSite.url )
		);

		void emitCliEvent( {
			event: SYNC_EVENTS.COMPLETED,
			data: {
				event: SYNC_EVENTS.COMPLETED,
				type: 'push',
				localSiteId: site.id,
				remoteSiteId: selectedSite.id,
				remoteSiteName: selectedSite.name,
			},
		} );
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
