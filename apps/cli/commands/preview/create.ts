import fs from 'fs';
import os from 'os';
import path from 'path';
import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { createsPreviewsOnWpcom } from '@studio/common/lib/snapshots';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { type Snapshot } from '@studio/common/types/snapshot';
import { __, sprintf } from '@wordpress/i18n';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { countSitePreviews, getNextSnapshotSequence } from 'cli/lib/cli-config/snapshots';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { createPreviewSite, type PreviewSite, uploadPreviewArchive } from 'cli/lib/preview-sites';
import { withSiteOperation } from 'cli/lib/site-operations';
import { getSnapshotsFromConfig, saveSnapshotToConfig } from 'cli/lib/snapshots';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { classifyPreviewFailure } from 'cli/lib/utils';
import { validateSiteSize } from 'cli/lib/validation';
import { requireAuthToken } from 'cli/lib/wpcom-auth';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

export async function runCommand(
	siteFolder: string,
	name?: string,
	logger: Logger< LoggerAction > = new Logger< LoggerAction >()
): Promise< Snapshot > {
	const archivePath = path.join(
		os.tmpdir(),
		`${ path.basename( siteFolder ) }-${ Date.now() }.zip`
	);
	const startedAt = Date.now();
	let siteId: string | undefined;
	let step: LoggerAction | undefined;
	let archiveBytes: number | undefined;

	try {
		const site = await getSiteByFolder( siteFolder );
		siteId = site.id;
		const reportStep = ( action: LoggerAction, message: string, progress: number ) => {
			step = action;
			logger.reportStart( action, message );
			void reportSyncActivity( site.id, {
				kind: 'pending',
				direction: 'preview',
				message,
				progress,
			} );
		};
		const token = await requireAuthToken();
		reportStep( LoggerAction.VALIDATE, __( 'Validating…' ), 0 );
		const onWpcom = await createsPreviewsOnWpcom( token.accessToken );
		await validateSiteSize( siteFolder, { onWpcom } );

		reportStep( LoggerAction.ARCHIVE, __( 'Creating archive…' ), 5 );
		await withSiteOperation( siteFolder, 'export', () =>
			archiveSiteContent( siteFolder, archivePath, { onWpcom } )
		);
		archiveBytes = fs.statSync( archivePath, { throwIfNoEntry: false } )?.size;
		logger.reportSuccess( __( 'Archive created' ) );

		let snapshotName = name;
		if ( ! snapshotName ) {
			const snapshots = await getSnapshotsFromConfig( token.id );
			const sequence = getNextSnapshotSequence( site.id, snapshots, token.id );
			snapshotName = sprintf(
				/* translators: 1: Site name 2: Sequence number (e.g. "My Site Name Preview 1") */
				__( '%1$s Preview %2$d' ),
				site.name,
				sequence
			);
		}

		reportStep( LoggerAction.UPLOAD, __( 'Uploading archive…' ), 30 );
		let preview: PreviewSite;
		if ( onWpcom ) {
			const attachmentId = await uploadPreviewArchive( archivePath, token.accessToken );
			logger.reportSuccess( __( 'Archive uploaded' ) );

			reportStep( LoggerAction.READY, __( 'Creating preview site…' ), 60 );
			preview = await createPreviewSite( attachmentId, snapshotName, token.accessToken );
		} else {
			const wordpressVersion = getWordPressVersion( siteFolder );
			const upload = await uploadArchive( archivePath, token.accessToken, wordpressVersion );
			logger.reportSuccess( __( 'Archive uploaded' ) );

			reportStep( LoggerAction.READY, __( 'Creating preview site…' ), 60 );
			await waitForSiteReady( upload.site_id, token.accessToken );
			preview = { siteId: upload.site_id, hostname: upload.site_url };
		}
		const link = preview.shareUrl ?? `https://${ preview.hostname }`;
		logger.reportSuccess( sprintf( __( 'Preview site available at: %s' ), link ) );

		reportStep( LoggerAction.APPDATA, __( 'Saving preview site to Studio…' ), 95 );
		const snapshot = await saveSnapshotToConfig(
			siteFolder,
			preview.siteId,
			preview.hostname,
			token.id,
			snapshotName,
			preview.shareUrl
		);
		logger.reportSuccess( __( 'Preview site saved to Studio' ) );
		await emitCliEvent( { event: SNAPSHOT_EVENTS.CREATED, data: { snapshotUrl: snapshot.url } } );
		await recordPreviewCreateEvent( {
			success: true,
			time_ms: Date.now() - startedAt,
			archive_bytes: archiveBytes,
			site_preview_count: countSitePreviews(
				site.id,
				await getSnapshotsFromConfig( token.id ),
				token.id
			),
		} );
		await reportSyncActivity( siteId, { kind: 'success', direction: 'preview' } );

		logger.reportResult( { name: snapshot.name, url: snapshot.url } );
		return snapshot;
	} catch ( error ) {
		if ( siteId ) {
			await reportSyncActivity( siteId, {
				kind: 'error',
				direction: 'preview',
				message: error instanceof Error ? error.message : String( error ),
			} );
		}
		await recordPreviewCreateEvent( {
			success: false,
			failure_reason: classifyPreviewFailure( error, step ),
			time_ms: Date.now() - startedAt,
			archive_bytes: archiveBytes,
		} );
		throw error instanceof LoggerError
			? error
			: new LoggerError( __( 'Failed to create preview site' ), error );
	} finally {
		void cleanup( archivePath );
	}
}

async function recordPreviewCreateEvent( props: {
	success: boolean;
	failure_reason?: string;
	time_ms: number;
	// Size of the uploaded archive, so preview times and failures can be read against site size.
	archive_bytes?: number;
	// Unexpired previews of this local site, this one included, so we can see how many people keep
	// several previews of the same site without identifying the site.
	site_preview_count?: number;
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
			const logger = new Logger< LoggerAction >();
			try {
				await runCommand( argv.path, argv.name, logger );
			} catch ( error ) {
				logger.reportError( error as LoggerError );
			}
		},
	} );
};
