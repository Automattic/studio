import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import {
	getSnapshotLink,
	isSnapshotExpired,
	isWpcomPreview,
} from '@studio/common/lib/snapshots';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { Snapshot } from '@studio/common/types/snapshot';
import { __, _n, sprintf } from '@wordpress/i18n';
import { cleanup, archiveSiteContent } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { countSitePreviews } from 'cli/lib/cli-config/snapshots';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { deleteSnapshotSite, updatePreviewSite, uploadPreviewArchive } from 'cli/lib/preview-sites';
import { withSiteOperation } from 'cli/lib/site-operations';
import { getSiteTracksProps } from 'cli/lib/site-tracks';
import { getSiteVersion } from 'cli/lib/site-versions';
import {
	deleteSnapshotFromConfig,
	getSnapshotsFromConfig,
	saveSnapshotToConfig,
	updateSnapshotInConfig,
} from 'cli/lib/snapshots';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { classifyPreviewFailure } from 'cli/lib/utils';
import { validateSiteSize } from 'cli/lib/validation';
import { requireAuthToken } from 'cli/lib/wpcom-auth';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import { createWpcomPreviewSite } from './create';

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
	let preview: Snapshot | undefined;
	let step: LoggerAction | undefined;
	let archiveBytes: number | undefined;

	try {
		const token = await requireAuthToken();
		const snapshots = await getSnapshotsFromConfig( token.id );
		const snapshotToUpdate = await getSnapshotToUpdate( snapshots, host, siteFolder, overwrite );
		preview = snapshotToUpdate;
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

		if ( isSnapshotExpired( snapshotToUpdate ) ) {
			throw new LoggerError( __( 'Cannot update an expired preview site.' ), undefined, 'expired' );
		}
		let snapshot: Snapshot;

		// A preview made on Jurassic Ninja moves to WordPress.com when it's updated.
		if ( ! isWpcomPreview( snapshotToUpdate ) ) {
			const created = await createWpcomPreviewSite( {
				siteId: site.id,
				siteFolder,
				archivePath,
				name: snapshotToUpdate.name ?? site.name,
				accessToken: token.accessToken,
				logger,
				reportStep,
				onArchiveBytes: ( bytes ) => ( archiveBytes = bytes ),
			} );
			reportStep( LoggerAction.APPDATA, __( 'Saving preview site to Studio…' ), 95 );
			snapshot = await saveSnapshotToConfig(
				siteFolder,
				created.preview.siteId,
				created.preview.hostname,
				token.id,
				snapshotToUpdate.name ?? site.name,
				created.preview.shareUrl,
				created.versionId
			);
			await deleteSnapshotFromConfig( snapshotToUpdate.url );
			await emitCliEvent( {
				event: SNAPSHOT_EVENTS.DELETED,
				data: { snapshotUrl: snapshotToUpdate.url },
			} );
			try {
				await deleteSnapshotSite( snapshotToUpdate, token.accessToken );
			} catch {
				logger.reportWarning(
					__( 'Could not delete the old preview site. It will expire on its own.' )
				);
			}
			logger.reportSuccess(
				sprintf(
					/* translators: %s: new preview link */
					__( 'Your preview moved to WordPress.com, so its link changed. New link: %s' ),
					getSnapshotLink( snapshot )
				)
			);
		} else {
			await validateSiteSize( siteFolder, { onWpcom: true } );

			reportStep( LoggerAction.ARCHIVE, __( 'Creating archive…' ), 5 );
			// The version is taken under the same lock as the archive, so it's what the preview holds.
			const versionId = await withSiteOperation( siteFolder, 'export', async () => {
				const version = await getSiteVersion( site.id, siteFolder );
				await archiveSiteContent( siteFolder, archivePath, { onWpcom: true } );
				return version;
			} );
			archiveBytes = fs.statSync( archivePath, { throwIfNoEntry: false } )?.size;
			logger.reportSuccess( __( 'Archive created' ) );

			reportStep( LoggerAction.UPLOAD, __( 'Uploading archive…' ), 30 );
			const attachmentId = await uploadPreviewArchive(
				archivePath,
				token.accessToken,
				snapshotToUpdate.atomicSiteId
			);
			logger.reportSuccess( __( 'Archive uploaded' ) );

			reportStep( LoggerAction.READY, __( 'Updating preview site…' ), 60 );
			const { shareUrl } = await updatePreviewSite(
				snapshotToUpdate.atomicSiteId,
				attachmentId,
				token.accessToken
			);

			reportStep( LoggerAction.APPDATA, __( 'Saving preview site to Studio…' ), 95 );
			snapshot = await updateSnapshotInConfig(
				snapshotToUpdate.atomicSiteId,
				siteFolder,
				shareUrl,
				versionId
			);
			logger.reportSuccess(
				sprintf( __( 'Preview site available at: %s' ), getSnapshotLink( snapshot ) )
			);
		}
		await emitCliEvent( { event: SNAPSHOT_EVENTS.UPDATED, data: { snapshotUrl: snapshot.url } } );
		await recordPreviewUpdateEvent( siteFolder, preview, {
			success: true,
			time_ms: Date.now() - startedAt,
			archive_bytes: archiveBytes,
			site_preview_count: countSitePreviews( site.id, snapshots, token.id ),
		} );
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
		await recordPreviewUpdateEvent( siteFolder, preview, {
			success: false,
			failure_reason: classifyPreviewFailure( error, step ),
			time_ms: Date.now() - startedAt,
			archive_bytes: archiveBytes,
		} );
		throw error instanceof LoggerError
			? error
			: new LoggerError( __( 'Failed to update preview site' ), error );
	} finally {
		void cleanup( archivePath );
	}
}

async function recordPreviewUpdateEvent(
	siteFolder: string,
	snapshot: Snapshot | undefined,
	props: {
		success: boolean;
		failure_reason?: string;
		time_ms: number;
		archive_bytes?: number;
		site_preview_count?: number;
	}
): Promise< void > {
	try {
		await recordTracksEvent( TRACKS_EVENTS.PREVIEW_SITE_UPDATE, {
			...props,
			...( await getSiteTracksProps( siteFolder, snapshot ) ),
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
