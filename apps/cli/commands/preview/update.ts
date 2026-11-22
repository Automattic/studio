import os from 'node:os';
import path from 'node:path';
import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import { getSiteTracksProps } from '@studio/common/lib/site-tracks';
import { getSnapshotLink, isSnapshotExpired, isWpcomPreview } from '@studio/common/lib/snapshots';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { Snapshot } from '@studio/common/types/snapshot';
import { __, _n, sprintf } from '@wordpress/i18n';
import { cleanup } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { countSitePreviews } from 'cli/lib/cli-config/snapshots';
import { emitCliEvent } from 'cli/lib/daemon-client';
import {
	deleteSnapshotFromConfig,
	getSnapshotsFromConfig,
	saveSnapshotToConfig,
	updateSnapshotInConfig,
} from 'cli/lib/snapshots';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { classifyPreviewFailure } from 'cli/lib/utils';
import { requireAuthToken } from 'cli/lib/wpcom-auth';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import { buildWpcomPreview, reportLaunchUrl } from './create';

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
	logger: Logger< LoggerAction > = new Logger< LoggerAction >(),
	liveSiteSelection?: string
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
		// A preview made on Jurassic Ninja moves to WordPress.com when it's updated, and the old one
		// is left to expire.
		const moving = ! isWpcomPreview( snapshotToUpdate );
		const name = snapshotToUpdate.name ?? site.name;
		const {
			preview: built,
			versionId,
			warning,
		} = await buildWpcomPreview( {
			siteId: site.id,
			existingPreview: isWpcomPreview( snapshotToUpdate ) ? snapshotToUpdate : undefined,
			liveSiteSelection,
			siteFolder,
			archivePath,
			target: moving ? { name } : { siteId: snapshotToUpdate.atomicSiteId },
			accessToken: token.accessToken,
			logger,
			reportStep,
			onArchiveBytes: ( bytes ) => ( archiveBytes = bytes ),
		} );
		reportStep( LoggerAction.APPDATA, __( 'Saving preview site to Studio…' ), 95 );
		let snapshot: Snapshot;
		if ( moving ) {
			snapshot = await saveSnapshotToConfig( siteFolder, built, token.id, name, versionId );
			await deleteSnapshotFromConfig( snapshotToUpdate.url );
			await emitCliEvent( {
				event: SNAPSHOT_EVENTS.DELETED,
				data: { snapshotUrl: snapshotToUpdate.url },
			} );
			logger.reportSuccess(
				sprintf(
					/* translators: %s: new preview link */
					__( 'Your preview moved to WordPress.com, so its link changed. New link: %s' ),
					getSnapshotLink( snapshot )
				)
			);
		} else {
			snapshot = await updateSnapshotInConfig( siteFolder, built, versionId );
			logger.reportSuccess(
				sprintf( __( 'Preview site available at: %s' ), getSnapshotLink( snapshot ) )
			);
		}
		reportLaunchUrl( built.launchUrl, logger );
		await emitCliEvent( { event: SNAPSHOT_EVENTS.UPDATED, data: { snapshotUrl: snapshot.url } } );
		await recordPreviewUpdateEvent( siteFolder, preview, {
			success: true,
			time_ms: Date.now() - startedAt,
			archive_bytes: archiveBytes,
			site_preview_count: countSitePreviews( site.id, snapshots, token.id ),
		} );
		await reportSyncActivity( siteId, { kind: 'success', direction: 'preview', warning } );
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
			...( await getSiteTracksProps( { siteFolder: siteFolder }, snapshot ) ),
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
				.option( 'live-site', {
					type: 'string',
					description: __( 'Connected live site ID, or none' ),
				} )
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
				await runCommand( argv.path, normalizedHost, argv.overwrite, logger, argv.liveSite );
			} catch ( error ) {
				logger.reportError( error as LoggerError );
			}
		},
	} );
};
