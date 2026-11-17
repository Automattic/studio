import fs from 'fs';
import path from 'path';
import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { selectLiveSite } from '@studio/common/lib/live-preview-site';
import { isWpcomPreview } from '@studio/common/lib/snapshots';
import { __ } from '@wordpress/i18n';
import { deleteSnapshot } from 'cli/lib/api';
import { toLoggerError, wpcomSites } from 'cli/lib/sync-api';
import { LoggerError } from 'cli/logger';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { SyncSite } from '@studio/common/types/sync';
import type { PreviewOptions, PreviewSite, PushContent, PushStatus } from '@studio/providers';

// Previews are WordPress.com's (`sites.previews`), which makes and rebuilds them from a push.
// Studio keeps which local site each one was made from, in `cli.json`.

export const wpcomPreviews = wpcomSites.previews!;

function zipContent( archivePath: string ): PushContent {
	return {
		kind: 'archive',
		file: fs.createReadStream( archivePath ),
		name: path.basename( archivePath ),
		size: fs.statSync( archivePath ).size,
	};
}

/**
 * Builds a preview from the zip of a local site: a new one, or `siteId`'s again, which is a push to
 * it. Resolves with the preview as WordPress.com reports it once it's built.
 */
export async function buildPreviewSite(
	token: string,
	archivePath: string,
	target: { siteId: number } | { name: string },
	options: PreviewOptions,
	onStatus: ( status: PushStatus ) => void
): Promise< PreviewSite > {
	const config = { token };
	try {
		if ( 'name' in target ) {
			return await wpcomPreviews.create(
				config,
				zipContent( archivePath ),
				{ ...options, name: target.name },
				onStatus
			);
		}
		await wpcomSites.push(
			config,
			{ id: target.siteId, name: '' },
			zipContent( archivePath ),
			{ preview: options },
			onStatus
		);
		const preview = ( await wpcomPreviews.list( config ) ).find(
			( item ) => item.id === target.siteId
		);
		if ( ! preview?.shareUrl ) {
			throw new LoggerError( __( 'The preview site has no preview link.' ) );
		}
		return preview;
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
	selection?: string
): Promise< SyncSite | undefined > {
	return selectLiveSite( await getConnectedWpcomSitesForLocalSite( localSiteId ), selection );
}

/** Deletes the site behind a saved preview, wherever it was made. */
export async function deleteSnapshotSite( snapshot: Snapshot, token: string ): Promise< void > {
	if ( ! isWpcomPreview( snapshot ) ) {
		// A preview made on Jurassic Ninja.
		await deleteSnapshot( snapshot.atomicSiteId, token );
		return;
	}
	try {
		await wpcomPreviews.delete( { token }, { id: snapshot.atomicSiteId } );
	} catch ( error ) {
		throw toLoggerError( error, __( 'Failed to delete preview site' ) );
	}
}
