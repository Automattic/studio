import os from 'os';
import path from 'path';
import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getNextSnapshotSequence } from 'cli/lib/cli-config/snapshots';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { getSnapshotsFromConfig, saveSnapshotToConfig } from 'cli/lib/snapshots';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { classifyPreviewFailure } from 'cli/lib/utils';
import { validateSiteSize } from 'cli/lib/validation';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand( siteFolder: string, name?: string ): Promise< void > {
	const archivePath = path.join(
		os.tmpdir(),
		`${ path.basename( siteFolder ) }-${ Date.now() }.zip`
	);
	const logger = new Logger< LoggerAction >();
	const startedAt = Date.now();

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating…' ) );
		await getSiteByFolder( siteFolder );
		await validateSiteSize( siteFolder );
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' )
			);
		}

		logger.reportStart( LoggerAction.ARCHIVE, __( 'Creating archive…' ) );
		await archiveSiteContent( siteFolder, archivePath );
		logger.reportSuccess( __( 'Archive created' ) );

		logger.reportStart( LoggerAction.UPLOAD, __( 'Uploading archive…' ) );
		const wordpressVersion = getWordPressVersion( siteFolder );
		const uploadResponse = await uploadArchive( archivePath, token.accessToken, wordpressVersion );
		logger.reportSuccess( __( 'Archive uploaded' ) );

		logger.reportStart( LoggerAction.READY, __( 'Creating preview site…' ) );
		await waitForSiteReady( uploadResponse.site_id, token.accessToken );
		logger.reportSuccess(
			sprintf( __( 'Preview site available at: %s' ), `https://${ uploadResponse.site_url }` )
		);

		logger.reportStart( LoggerAction.APPDATA, __( 'Saving preview site to Studio…' ) );
		let snapshotName = name;
		if ( ! snapshotName ) {
			const site = await getSiteByFolder( siteFolder );
			const snapshots = await getSnapshotsFromConfig( token.id );
			const sequence = getNextSnapshotSequence( site.id, snapshots, token.id );
			snapshotName = sprintf(
				/* translators: 1: Site name 2: Sequence number (e.g. "My Site Name Preview 1") */
				__( '%1$s Preview %2$d' ),
				site.name,
				sequence
			);
		}
		const snapshot = await saveSnapshotToConfig(
			siteFolder,
			uploadResponse.site_id,
			uploadResponse.site_url,
			token.id,
			snapshotName
		);
		logger.reportSuccess( __( 'Preview site saved to Studio' ) );
		await emitCliEvent( { event: SNAPSHOT_EVENTS.CREATED, data: { snapshotUrl: snapshot.url } } );
		await recordPreviewCreateEvent( { success: true, time_ms: Date.now() - startedAt } );

		logger.reportKeyValuePair( 'name', snapshot.name ?? '' );
		logger.reportKeyValuePair( 'url', snapshot.url );
	} catch ( error ) {
		await recordPreviewCreateEvent( {
			success: false,
			failure_reason: classifyPreviewFailure( error ),
			time_ms: Date.now() - startedAt,
		} );
		if ( error instanceof LoggerError ) {
			logger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Failed to create preview site' ), error );
			logger.reportError( loggerError );
		}
	} finally {
		void cleanup( archivePath );
	}
}

async function recordPreviewCreateEvent( props: {
	success: boolean;
	failure_reason?: string;
	time_ms: number;
} ): Promise< void > {
	try {
		await recordTracksEvent( TRACKS_EVENTS.PREVIEW_SITE_CREATE, {
			...props,
			...getTracksOrigin(),
		} );
	} catch {
		// Best-effort telemetry — never block or fail preview creation.
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'create',
		describe: __( 'Create a preview site' ),
		builder: ( yargs ) => {
			return yargs.option( 'name', {
				type: 'string',
				description: __( 'Preview site name' ),
			} );
		},
		handler: async ( argv ) => {
			await runCommand( argv.path, argv.name );
		},
	} );
};
