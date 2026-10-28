import os from 'node:os';
import path from 'node:path';
import { DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getSnapshotLink, isWpcomPreview } from '@studio/common/lib/snapshots';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { Snapshot } from '@studio/common/types/snapshot';
import { __, _n, sprintf } from '@wordpress/i18n';
import { addDays } from 'date-fns/addDays';
import { uploadArchive, waitForSiteReady } from 'cli/lib/api';
import { cleanup, archiveSiteContent } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { updatePreviewSite, uploadPreviewArchive } from 'cli/lib/preview-sites';
import { withSiteOperation } from 'cli/lib/site-operations';
import { getSnapshotsFromConfig, updateSnapshotInConfig } from 'cli/lib/snapshots';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { classifyPreviewFailure } from 'cli/lib/utils';
import { validateSiteSize } from 'cli/lib/validation';
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
		throw new LoggerError( 'Preview site not found', undefined, 'not_found' );
	}

	if ( snapshotToUpdate.localSiteId !== currentSiteId && ! overwrite ) {
		throw new LoggerError(
			__(
				'The specified directory does not match the original site for this preview. If you want to overwrite, run the command with --overwrite.'
			),
			undefined,
			'site_mismatch'
		);
	}

	return snapshotToUpdate;
}

export async function runCommand(
	siteFolder: string,
	host: string,
	overwrite: boolean,
	logger: Logger< LoggerAction > = new Logger< LoggerAction >()
): Promise< Snapshot > {
	const archivePath = path.join(
		os.tmpdir(),
		`${ path.basename( siteFolder ) }-${ Date.now() }.zip`
	);
	const startedAt = Date.now();
	let siteId: string | undefined;
	let step: LoggerAction | undefined;

	try {
		const token = await readAuthToken();
		if ( ! token ) {
			throw new LoggerError(
				__( 'Authentication required. Please log in with `studio auth login`.' ),
				undefined,
				'auth_required'
			);
		}
		const snapshots = await getSnapshotsFromConfig( token.id );
		const snapshotToUpdate = await getSnapshotToUpdate( snapshots, host, siteFolder, overwrite );
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
				hostname: snapshotToUpdate.url,
			} );
		};
		reportStep( LoggerAction.VALIDATE, __( 'Validating…' ), 0 );

		const now = new Date();
		const endDate = addDays( snapshotToUpdate.date, DEMO_SITE_EXPIRATION_DAYS );
		if ( endDate < now ) {
			throw new LoggerError( __( 'Cannot update an expired preview site.' ), undefined, 'expired' );
		}
		await validateSiteSize( siteFolder );

		reportStep( LoggerAction.ARCHIVE, __( 'Creating archive…' ), 5 );
		await withSiteOperation( siteFolder, 'export', () =>
			archiveSiteContent( siteFolder, archivePath )
		);
		logger.reportSuccess( __( 'Archive created' ) );

		reportStep( LoggerAction.UPLOAD, __( 'Uploading archive…' ), 30 );
		let shareUrl: string | undefined;
		if ( isWpcomPreview( snapshotToUpdate ) ) {
			const attachmentId = await uploadPreviewArchive(
				archivePath,
				token.accessToken,
				snapshotToUpdate.atomicSiteId
			);
			logger.reportSuccess( __( 'Archive uploaded' ) );

			reportStep( LoggerAction.READY, __( 'Updating preview site…' ), 60 );
			( { shareUrl } = await updatePreviewSite(
				snapshotToUpdate.atomicSiteId,
				attachmentId,
				token.accessToken,
				snapshotToUpdate.shareUrl
			) );
		} else {
			// A preview made on Jurassic Ninja by an earlier Studio.
			await uploadArchive(
				archivePath,
				token.accessToken,
				getWordPressVersion( siteFolder ),
				snapshotToUpdate.atomicSiteId
			);
			logger.reportSuccess( __( 'Archive uploaded' ) );

			reportStep( LoggerAction.READY, __( 'Updating preview site…' ), 60 );
			await waitForSiteReady( snapshotToUpdate.atomicSiteId, token.accessToken );
		}

		reportStep( LoggerAction.APPDATA, __( 'Saving preview site to Studio…' ), 95 );
		const snapshot = await updateSnapshotInConfig(
			snapshotToUpdate.atomicSiteId,
			siteFolder,
			shareUrl
		);
		logger.reportSuccess(
			sprintf( __( 'Preview site available at: %s' ), getSnapshotLink( snapshot ) )
		);
		await emitCliEvent( { event: SNAPSHOT_EVENTS.UPDATED, data: { snapshotUrl: snapshot.url } } );
		await recordPreviewUpdateEvent( { success: true, time_ms: Date.now() - startedAt } );
		await reportSyncActivity( siteId, { kind: 'success', direction: 'preview' } );
		logger.reportSuccess( __( 'Preview site saved to Studio' ) );

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
		await recordPreviewUpdateEvent( {
			success: false,
			failure_reason: classifyPreviewFailure( error, step ),
			time_ms: Date.now() - startedAt,
		} );
		throw error instanceof LoggerError
			? error
			: new LoggerError( __( 'Failed to update preview site' ), error );
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
			const logger = new Logger< LoggerAction >();
			try {
				await runCommand( argv.path, normalizedHost, argv.overwrite, logger );
			} catch ( error ) {
				logger.reportError( error as LoggerError );
			}
		},
	} );
};
