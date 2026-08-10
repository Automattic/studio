import fs from 'fs';
import { deleteAiSessionsForSite } from '@studio/common/ai/sessions/manage';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { removeAllConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { readAuthToken, type StoredAuthToken } from '@studio/common/lib/shared-config';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import trash from 'trash';
import { deleteSnapshot } from 'cli/lib/api';
import { deleteSiteCertificate } from 'cli/lib/certificate-manager';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import { removeDomainFromHosts } from 'cli/lib/hosts-file';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { getSnapshotsFromConfig, deleteSnapshotFromConfig } from 'cli/lib/snapshots';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

async function deletePreviewSites( authToken: StoredAuthToken, siteFolder: string ) {
	try {
		const snapshots = await getSnapshotsFromConfig( authToken.id, siteFolder );

		if ( snapshots.length > 0 ) {
			logger.reportStart(
				LoggerAction.DELETE_PREVIEW_SITES,
				// translators: %d is the number of associated preview sites
				sprintf(
					_n(
						'Deleting %d associated preview site…',
						'Deleting %d associated preview sites…',
						snapshots.length
					),
					snapshots.length
				)
			);

			await Promise.all(
				snapshots.map( async ( snapshot ) => {
					await deleteSnapshot( snapshot.atomicSiteId, authToken.accessToken );
					await deleteSnapshotFromConfig( snapshot.url );
				} )
			);

			logger.reportSuccess( __( 'Associated preview sites deleted' ) );
		}
	} catch ( error ) {
		logger.reportError(
			new LoggerError(
				__( 'Failed to delete associated preview sites. Proceeding anyway…' ),
				error
			),
			false
		);
	}
}

export async function runCommand(
	siteFolder: string,
	deleteFiles: boolean = true
): Promise< void > {
	try {
		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( siteFolder );
		logger.reportSuccess( __( 'Site loaded' ) );

		const runningProcess = await isServerRunning( site.id );
		if ( runningProcess ) {
			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress server…' ) );
			await stopWordPressServer( site.id );
			logger.reportSuccess( __( 'WordPress server stopped' ) );
			await stopProxyIfNoSitesNeedIt( site.id, logger );
		}

		if ( site.customDomain ) {
			logger.reportStart(
				LoggerAction.REMOVE_DOMAIN_FROM_HOSTS,
				__( 'Removing domain from hosts file…' )
			);
			await removeDomainFromHosts( site.customDomain );
			logger.reportSuccess( __( 'Domain removed from hosts file' ) );

			if ( site.enableHttps ) {
				logger.reportStart( LoggerAction.DELETE_CERT, __( 'Deleting SSL certificates…' ) );
				deleteSiteCertificate( site.customDomain );
				logger.reportSuccess( __( 'SSL certificates deleted' ) );
			}
		}

		const authToken = await readAuthToken();
		if ( authToken ) {
			await deletePreviewSites( authToken, siteFolder );
		}

		try {
			await lockCliConfig();
			const cliConfig = await readCliConfig();
			const siteIndex = cliConfig.sites.findIndex( ( s ) => arePathsEqual( s.path, siteFolder ) );
			if ( siteIndex === -1 ) {
				throw new LoggerError( __( 'The specified directory is not added to Studio.' ) );
			}
			cliConfig.sites.splice( siteIndex, 1 );
			await saveCliConfig( cliConfig );
		} finally {
			await unlockCliConfig();
		}

		try {
			await removeAllConnectedWpcomSitesForLocalSite( site.id );
		} catch ( error ) {
			logger.reportError(
				new LoggerError(
					__( 'Failed to remove WordPress.com connections. Proceeding anyway…' ),
					error
				),
				false
			);
		}

		try {
			await deleteAiSessionsForSite( getSessionsDirectory(), {
				id: site.id,
				path: site.path,
			} );
		} catch ( error ) {
			logger.reportError(
				new LoggerError( __( 'Failed to delete chat sessions. Proceeding anyway…' ), error ),
				false
			);
		}

		if ( deleteFiles ) {
			// Imported sites have both a visible site directory and a
			// hidden technical directory under ~/.studio/imports; delete
			// both if they exist.
			const deleteTargets = [ siteFolder, site.technicalSiteDirectory ].filter(
				( value ): value is string => typeof value === 'string' && fs.existsSync( value )
			);

			if ( deleteTargets.length > 0 ) {
				logger.reportStart( LoggerAction.DELETE_FILES, __( 'Moving site files to trash…' ) );
				await trash( deleteTargets );
				logger.reportSuccess( __( 'Site files moved to trash' ) );
			} else {
				logger.reportSuccess( __( 'Site files already removed' ) );
			}
		}

		await emitCliEvent( { event: SITE_EVENTS.DELETED, data: { siteId: site.id } } );

		// Tracks: the CLI is the sole emitter of site-delete, whether deleted standalone or by the
		// desktop app (which delegates to `site delete` and passes its origin via STUDIO_TRACKS_ORIGIN).
		// Best-effort — wrapped so telemetry can never fail a delete.
		try {
			await recordTracksEvent( TRACKS_EVENTS.SITE_DELETE, {
				...getTracksOrigin(),
				delete_files: deleteFiles,
			} );
		} catch {
			// Best-effort telemetry — never block or fail a delete.
		}
	} finally {
		await disconnectFromDaemon();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'delete',
		describe: __( 'Delete site' ),
		builder: ( yargs ) => {
			return yargs.option( 'files', {
				type: 'boolean',
				description: __( 'Move site files to trash (use --no-files to keep files)' ),
				default: true,
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.files );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to delete site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
