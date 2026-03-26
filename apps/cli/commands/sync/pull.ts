import os from 'os';
import path from 'path';
import { confirm } from '@inquirer/prompts';
import { readAuthToken } from '@studio/common/lib/shared-config';
import {
	SYNC_MAX_STALLED_ATTEMPTS,
	SYNC_POLL_INTERVAL_MS,
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import {
	checkBackupSize,
	fetchSyncableSites,
	initiateBackup,
	parseSyncOptions,
	pollBackupStatus,
	downloadBackup,
} from 'cli/lib/sync-api';
import { fetchPullTree, selectSyncItemsForPull } from 'cli/lib/sync-selector';
import { findSyncSiteByIdentifier, pickSyncSite } from 'cli/lib/sync-site-picker';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { SyncOption } from '@studio/common/types/sync';

export async function runCommand(
	siteFolder: string,
	optionsString?: string,
	siteIdentifier?: string
): Promise< void > {
	const logger = new Logger< LoggerAction >();

	try {
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}

		await getSiteByFolder( siteFolder );

		logger.reportStart( LoggerAction.FETCH_SITES, __( 'Fetching WordPress.com sites…' ) );
		const sites = await fetchSyncableSites( token.accessToken );
		logger.spinner.stop();
		logger.reportSuccess( sprintf( __( 'Found %d sites' ), sites.length ), true );

		let selectedSite;
		if ( siteIdentifier ) {
			selectedSite = findSyncSiteByIdentifier( sites, siteIdentifier );
		} else {
			selectedSite = await pickSyncSite( sites, __( 'Select a site to pull from' ) );
			if ( ! selectedSite ) {
				return;
			}
		}

		let optionsToSync: SyncOption[];
		let includePathList: string[] | undefined;

		if ( optionsString ) {
			optionsToSync = parseSyncOptions( optionsString );
		} else {
			logger.reportStart( LoggerAction.FETCH_SITES, __( 'Fetching file tree…' ) );
			const { tree } = await fetchPullTree( token.accessToken, selectedSite.id );
			logger.spinner.stop();

			const selection = await selectSyncItemsForPull( token.accessToken, selectedSite.id, tree );
			if ( ! selection ) {
				return;
			}
			optionsToSync = selection.optionsToSync;
			includePathList = selection.includePathList;
		}

		const remoteSiteId = selectedSite.id;
		const remoteSiteName = selectedSite.name;
		const remoteSiteUrl = selectedSite.url;

		// Pull progress: Backup (0-50%) → Download (50-80%) → Import (80-100%)
		logger.reportStart(
			LoggerAction.INITIATE_BACKUP,
			sprintf( __( 'Initializing remote backup… (%d%%)' ), 0 )
		);
		const backupId = await initiateBackup( token.accessToken, remoteSiteId, {
			optionsToSync,
			includePathList,
		} );

		let downloadUrl: string | null = null;
		let lastPercent = -1;
		let stalledAttempts = 0;

		while ( stalledAttempts < SYNC_MAX_STALLED_ATTEMPTS ) {
			const status = await pollBackupStatus( token.accessToken, remoteSiteId, backupId );

			if ( status.status === 'failed' ) {
				throw new LoggerError( __( 'Remote backup failed' ) );
			}

			if ( status.status === 'finished' && status.downloadUrl ) {
				downloadUrl = status.downloadUrl;
				break;
			}

			const currentPercent = Math.round( status.percent );
			if ( currentPercent !== lastPercent ) {
				stalledAttempts = 0;
				lastPercent = currentPercent;
			} else {
				stalledAttempts++;
			}

			// Backup phase: 0-50%
			const backupProgress = Math.round( status.percent * 0.5 );
			logger.spinner.text = sprintf( __( 'Creating remote backup… (%d%%)' ), backupProgress );

			await new Promise( ( resolve ) => setTimeout( resolve, SYNC_POLL_INTERVAL_MS ) );
		}

		if ( ! downloadUrl ) {
			throw new LoggerError( __( 'Backup timed out — no progress detected' ) );
		}

		// Check backup size before downloading
		const backupFileSize = await checkBackupSize( downloadUrl );
		if ( backupFileSize > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
			logger.spinner.stop();
			const shouldContinue = await confirm( {
				message: sprintf(
					__(
						"Your site's backup exceeds %d GB. Pulling it will prevent you from pushing the site back. Do you want to continue?"
					),
					SYNC_PUSH_SIZE_LIMIT_GB
				),
				default: true,
			} );
			if ( ! shouldContinue ) {
				return;
			}
		}

		// Download phase: 50-80%
		logger.spinner.text = sprintf( __( 'Downloading backup… (%d%%)' ), 50 );
		const tempDir = path.join( os.tmpdir(), 'studio-sync' );
		const { mkdirSync } = await import( 'fs' );
		mkdirSync( tempDir, { recursive: true } );
		const destPath = path.join( tempDir, `pull-${ remoteSiteId }-${ Date.now() }.tar.gz` );
		await downloadBackup( downloadUrl, destPath );

		// TODO: Import backup into local site (80-100%)
		logger.spinner.stop();
		logger.reportSuccess(
			sprintf(
				__( 'Pulled from %s (%s). Backup saved to %s. Import not yet implemented in CLI.' ),
				remoteSiteName,
				remoteSiteUrl,
				destPath
			)
		);
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Pull failed' ), error );
			logger.reportError( loggerError );
		}
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'pull',
		describe: __( 'Pull a WordPress.com site to your local site' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'options', {
					type: 'string',
					description: __(
						'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents'
					),
				} )
				.option( 'site', {
					type: 'string',
					description: __( 'Remote site URL or ID (skips interactive site selection)' ),
				} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, argv.options, argv.site );
		},
	} );
};
