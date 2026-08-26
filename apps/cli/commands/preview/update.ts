import os from 'node:os';
import path from 'node:path';
import { DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { Snapshot } from '@studio/common/types/snapshot';
import { __, _n, sprintf } from '@wordpress/i18n';
import { addDays } from 'date-fns';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { cleanup, archiveSiteContent } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { getSnapshotsFromConfig, updateSnapshotInConfig } from 'cli/lib/snapshots';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { classifyPreviewFailure, normalizeHostname } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

async function getSnapshotToUpdate(
	snapshots: Snapshot[],
	host: string,
	siteFolder: string,
	overwrite: boolean
) {
	const site = await getSiteByFolder( siteFolder );
	const currentSiteId = site.id;

	const snapshotToUpdate = snapshots.find( ( s ) => s.url === host );
	if ( ! snapshotToUpdate ) {
		throw new LoggerError( 'Preview site not found' );
	}

	if ( snapshotToUpdate.localSiteId !== currentSiteId && ! overwrite ) {
		throw new LoggerError(
			__(
				'The specified directory does not match the original site for this preview. If you want to overwrite, run the command with --overwrite.'
			)
		);
	}

	return snapshotToUpdate;
}

export async function runCommand(
	siteFolder: string,
	host: string,
	overwrite: boolean,
	logger: Logger< LoggerAction > = new Logger< LoggerAction >()
): Promise< void > {
	const archivePath = path.join(
		os.tmpdir(),
		`${ path.basename( siteFolder ) }-${ Date.now() }.zip`
	);
	const startedAt = Date.now();

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating…' ) );
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}
		const snapshots = await getSnapshotsFromConfig( token.id );
		const snapshotToUpdate = await getSnapshotToUpdate( snapshots, host, siteFolder, overwrite );

		const now = new Date();
		const endDate = addDays( snapshotToUpdate.date, DEMO_SITE_EXPIRATION_DAYS );
		if ( endDate < now ) {
			throw new LoggerError( __( 'Cannot update an expired preview site.' ) );
		}

		logger.reportStart( LoggerAction.ARCHIVE, __( 'Creating archive…' ) );
		await archiveSiteContent( siteFolder, archivePath );
		logger.reportSuccess( __( 'Archive created' ) );

		logger.reportStart( LoggerAction.UPLOAD, __( 'Uploading archive…' ) );
		const wordpressVersion = getWordPressVersion( siteFolder );
		const uploadResponse = await uploadArchive(
			archivePath,
			token.accessToken,
			wordpressVersion,
			snapshotToUpdate.atomicSiteId
		);
		logger.reportSuccess( __( 'Archive uploaded' ) );

		logger.reportStart( LoggerAction.READY, __( 'Updating preview site…' ) );
		await waitForSiteReady( uploadResponse.site_id, token.accessToken );
		logger.reportSuccess(
			sprintf( __( 'Preview site available at: %s' ), `https://${ uploadResponse.site_url }` )
		);

		logger.reportStart( LoggerAction.APPDATA, __( 'Saving preview site to Studio…' ) );
		const snapshot = await updateSnapshotInConfig( uploadResponse.site_id, siteFolder );
		await emitCliEvent( { event: SNAPSHOT_EVENTS.UPDATED, data: { snapshotUrl: snapshot.url } } );
		await recordPreviewUpdateEvent( { success: true, time_ms: Date.now() - startedAt } );
		logger.reportSuccess( __( 'Preview site saved to Studio' ) );

		logger.reportKeyValuePair( 'name', snapshot.name ?? '' );
		logger.reportKeyValuePair( 'url', snapshot.url );
	} catch ( error ) {
		await recordPreviewUpdateEvent( {
			success: false,
			failure_reason: classifyPreviewFailure( error ),
			time_ms: Date.now() - startedAt,
		} );
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to update preview site' ), error );
			logger.reportError( loggerError );
		}
	} finally {
		void cleanup( archivePath );
	}
}

async function recordPreviewUpdateEvent( props: {
	success: boolean;
	failure_reason?: string;
	time_ms: number;
} ): Promise< void > {
	try {
		await recordTracksEvent( TRACKS_EVENTS.PREVIEW_SITE_UPDATE, {
			...props,
			...getTracksOrigin(),
		} );
	} catch {
		// Best-effort telemetry — never block or fail preview updates.
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'update <host>',
		describe: __( 'Update preview site' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'host', {
					type: 'string',
					description: __( 'Hostname of the preview site to update' ),
					demandOption: true,
				} )
				.option( 'overwrite', {
					alias: 'o',
					type: 'boolean',
					default: false,
					description: __( 'Allow updating a preview site from a different directory' ),
				} );
		},
		handler: async ( argv ) => {
			const normalizedHost = normalizeHostname( argv.host );
			await runCommand( argv.path, normalizedHost, argv.overwrite );
		},
	} );
};
