import fs from 'fs';
import os from 'os';
import path from 'path';
import { SNAPSHOT_EVENTS } from '@studio/common/lib/cli-events';
import { getSiteTracksProps } from '@studio/common/lib/site-tracks';
import { getEditedDefaultThemesWarning } from '@studio/common/lib/snapshots';
import { PreviewCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { type Snapshot } from '@studio/common/types/snapshot';
import { type SyncSite } from '@studio/common/types/sync';
import { __, sprintf } from '@wordpress/i18n';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { countSitePreviews, getNextSnapshotSequence } from 'cli/lib/cli-config/snapshots';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { findEditedDefaultThemes } from 'cli/lib/edited-default-themes';
import { buildPreviewSite, getLivePreviewSite } from 'cli/lib/preview-sites';
import { withSiteOperation } from 'cli/lib/site-operations';
import { getSiteVersion } from 'cli/lib/site-versions';
import { getSnapshotsFromConfig, saveSnapshotToConfig } from 'cli/lib/snapshots';
import { reportSyncActivity } from 'cli/lib/sync-activity';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { classifyPreviewFailure } from 'cli/lib/utils';
import { validateSiteSize } from 'cli/lib/validation';
import { requireAuthToken } from 'cli/lib/wpcom-auth';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { PreviewSite } from '@studio/providers';

export type ReportPreviewStep = ( action: LoggerAction, message: string, progress: number ) => void;

/**
 * Warns when the site's active default theme has edited files, which a WordPress.com preview
 * doesn't show. Returns the warning, for the preview's success activity. Never fails the preview.
 */
export async function warnAboutEditedDefaultThemes(
	siteFolder: string,
	logger: Logger< LoggerAction >
): Promise< string | undefined > {
	try {
		const themes = await findEditedDefaultThemes( siteFolder );
		if ( themes.length === 0 ) {
			return undefined;
		}
		const warning = getEditedDefaultThemesWarning( themes );
		logger.reportWarning( warning );
		return warning;
	} catch {
		return undefined;
	}
}

/**
 * Tells the owner where to buy the preview, which makes it their live site. A preview of changes to
 * a live site has no such link.
 */
export function reportLaunchUrl( launchUrl: string | undefined, logger: Logger< LoggerAction > ) {
	if ( launchUrl ) {
		logger.reportSuccess(
			/* translators: %s: link to WordPress.com's checkout for the preview site */
			sprintf( __( 'Make it your live site: %s' ), launchUrl )
		);
	}
}

/**
 * Builds a preview from a local site: validate, archive, then push it to a new preview (`name`) or
 * to an existing one (`siteId`). Shared by `preview create` and `preview update`.
 */
export async function buildWpcomPreview( {
	siteId,
	siteFolder,
	archivePath,
	target,
	accessToken,
	logger,
	reportStep,
	onArchiveBytes,
	liveSiteSelection,
	existingPreview,
}: {
	siteId: string;
	siteFolder: string;
	archivePath: string;
	target: { name: string } | { siteId: number };
	accessToken: string;
	logger: Logger< LoggerAction >;
	reportStep: ReportPreviewStep;
	onArchiveBytes?: ( bytes: number | undefined ) => void;
	liveSiteSelection?: string;
	existingPreview?: import('@studio/common/types/snapshot').Snapshot;
} ): Promise< {
	preview: PreviewSite;
	versionId: string;
	liveSite: SyncSite | undefined;
	warning: string | undefined;
} > {
	const liveSite = await getLivePreviewSite( siteId, liveSiteSelection, existingPreview );
	await validateSiteSize( siteFolder, { onWpcom: true } );
	const warning = await warnAboutEditedDefaultThemes( siteFolder, logger );

	reportStep( LoggerAction.ARCHIVE, __( 'Creating archive…' ), 5 );
	// The version is taken under the same lock as the archive, so it's what the preview holds.
	const versionId = await withSiteOperation( siteFolder, 'export', async () => {
		const version = await getSiteVersion( siteId, siteFolder );
		await archiveSiteContent( siteFolder, archivePath, { onWpcom: true } );
		return version;
	} );
	const archiveBytes = fs.statSync( archivePath, { throwIfNoEntry: false } )?.size;
	onArchiveBytes?.( archiveBytes );
	logger.reportSuccess( __( 'Archive created' ) );

	reportStep( LoggerAction.UPLOAD, __( 'Uploading archive…' ), 30 );
	let uploaded = false;
	const preview = await buildPreviewSite(
		accessToken,
		archivePath,
		target,
		{ originId: siteId, liveSiteId: liveSite?.id },
		( { phase } ) => {
			if ( phase === 'uploading' || uploaded ) {
				return;
			}
			uploaded = true;
			logger.reportSuccess( __( 'Archive uploaded' ) );
			reportStep(
				LoggerAction.READY,
				'name' in target ? __( 'Creating preview site…' ) : __( 'Updating preview site…' ),
				60
			);
		}
	);
	return { preview, versionId, liveSite, warning };
}

export async function runCommand(
	siteFolder: string,
	name?: string,
	logger: Logger< LoggerAction > = new Logger< LoggerAction >(),
	liveSiteSelection?: string
): Promise< Snapshot > {
	const archivePath = path.join(
		os.tmpdir(),
		`${ path.basename( siteFolder ) }-${ Date.now() }.zip`
	);
	const startedAt = Date.now();
	let siteId: string | undefined;
	let snapshot: Snapshot | undefined;
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

		const { preview, versionId, liveSite, warning } = await buildWpcomPreview( {
			siteId: site.id,
			liveSiteSelection,
			siteFolder,
			archivePath,
			target: { name: snapshotName },
			accessToken: token.accessToken,
			logger,
			reportStep,
			onArchiveBytes: ( bytes ) => ( archiveBytes = bytes ),
		} );
		const link = preview.shareUrl ?? preview.url;
		logger.reportSuccess( sprintf( __( 'Preview site available at: %s' ), link ) );
		if ( liveSite && preview.liveSiteId === liveSite.id ) {
			logger.reportSuccess(
				sprintf(
					/* translators: %s: Name or URL of the connected WordPress.com site */
					__( 'Publish to %s to apply these changes.' ),
					liveSite.name || liveSite.url
				)
			);
		}
		reportLaunchUrl( preview.launchUrl, logger );

		reportStep( LoggerAction.APPDATA, __( 'Saving preview site to Studio…' ), 95 );
		snapshot = await saveSnapshotToConfig( siteFolder, preview, token.id, snapshotName, versionId );
		logger.reportSuccess( __( 'Preview site saved to Studio' ) );
		await emitCliEvent( { event: SNAPSHOT_EVENTS.CREATED, data: { snapshotUrl: snapshot.url } } );
		await recordPreviewCreateEvent( siteFolder, snapshot, {
			success: true,
			time_ms: Date.now() - startedAt,
			archive_bytes: archiveBytes,
			site_preview_count: countSitePreviews(
				site.id,
				await getSnapshotsFromConfig( token.id ),
				token.id
			),
		} );
		await reportSyncActivity( siteId, { kind: 'success', direction: 'preview', warning } );

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
		await recordPreviewCreateEvent( siteFolder, snapshot, {
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

async function recordPreviewCreateEvent(
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
		await recordTracksEvent( TRACKS_EVENTS.PREVIEW_SITE_CREATE, {
			...props,
			...( await getSiteTracksProps( { siteFolder: siteFolder }, snapshot ) ),
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
			return yargs
				.option( 'live-site', {
					type: 'string',
					description: __( 'Connected live site ID, or none' ),
				} )
				.option( 'name', {
					type: 'string',
					description: __( 'Preview site name' ),
				} );
		},
		handler: async ( argv ) => {
			const logger = new Logger< LoggerAction >();
			try {
				await runCommand( argv.path, argv.name, logger, argv.liveSite );
			} catch ( error ) {
				logger.reportError( error as LoggerError );
			}
		},
	} );
};
