import fs from 'fs';
import path from 'path';
import { getQualifyingLiveSites, selectLiveSite } from '@studio/common/lib/live-preview-site';
import { getRemoteSites } from '@studio/common/lib/remote-sites';
import { buildPreview, isWpcomPreview } from '@studio/common/lib/snapshots';
import { __ } from '@wordpress/i18n';
import { toLoggerError, wpcomSites } from 'cli/lib/sync-api';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { SyncSite } from '@studio/common/types/sync';
import type { PreviewOptions, PreviewSite, PushContent, PushStatus } from '@studio/providers';

// Previews are WordPress.com's (`sites.previews`), which makes and rebuilds them from a push.
// Studio keeps which local site each one was made from, in the config file.

export const wpcomPreviews = wpcomSites.previews!;

function zipContent( archivePath: string ): PushContent {
	return {
		kind: 'archive',
		file: fs.createReadStream( archivePath ),
		name: path.basename( archivePath ),
		size: fs.statSync( archivePath ).size,
	};
}

/** Builds a preview on WordPress.com from the zip of a local site; see `buildPreview`. */
export async function buildPreviewSite(
	token: string,
	archivePath: string,
	target: { siteId: number } | { name: string },
	options: PreviewOptions,
	onStatus: ( status: PushStatus ) => void
): Promise< PreviewSite > {
	try {
		return await buildPreview(
			wpcomSites,
			{ token },
			zipContent( archivePath ),
			target,
			options,
			onStatus
		);
	} catch ( error ) {
		throw toLoggerError(
			error,
			'name' in target
				? __( 'Failed to create preview site' )
				: __( 'Failed to update preview site' )
		);
	}
}

/** The local site's live site that a preview shows changes to; see `selectLiveSite`. */
export async function getLivePreviewSite(
	localSiteId: string,
	selection?: string,
	existingPreview?: Snapshot
): Promise< SyncSite | undefined > {
	const sites = await getRemoteSites( 'wpcom', localSiteId );
	if ( selection === undefined && existingPreview ) {
		return getQualifyingLiveSites( sites ).find(
			( site ) => site.id === existingPreview.liveSiteId
		);
	}
	return selectLiveSite( sites, selection );
}

/**
 * Takes down the site behind a saved preview. A Jurassic Ninja preview made by an earlier release
 * is left to expire.
 */
export async function deleteSnapshotSite( snapshot: Snapshot, token: string ): Promise< void > {
	if ( ! isWpcomPreview( snapshot ) ) {
		return;
	}
	try {
		await wpcomPreviews.delete( { token }, { id: snapshot.atomicSiteId } );
	} catch ( error ) {
		throw toLoggerError( error, __( 'Failed to delete preview site' ) );
	}
}
