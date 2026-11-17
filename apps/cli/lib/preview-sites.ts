import fs from 'fs';
import path from 'path';
import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { selectLiveSite } from '@studio/common/lib/live-preview-site';
import { isWpcomPreview } from '@studio/common/lib/snapshots';
import { getProviderServices } from '@studio/providers/services';
import { __ } from '@wordpress/i18n';
import { deleteSnapshot } from 'cli/lib/api';
import { toLoggerError } from 'cli/lib/sync-api';
import { LoggerError } from 'cli/logger';
import type { Snapshot } from '@studio/common/types/snapshot';
import type { SyncSite } from '@studio/common/types/sync';
import type { PreviewOptions, PreviewSite, PushContent, PushStatus } from '@studio/providers';

// Previews are WordPress.com's (`sites.previews`), which makes and rebuilds them from a push.
// Studio keeps which local site each one was made from, in `cli.json`.

export type StandingPreview = {
	// The host the preview is served from: its preview link's host once it has one.
	hostname?: string;
	// When it expires (ms).
	expiresAt?: number;
	shareUrl?: string;
	// The paid site WordPress.com shows this preview as changes to, when it accepted the link.
	liveSiteId?: number;
	// Where the owner buys the preview to make it their live site. Absent for a preview of changes
	// to a live site, which is published there instead.
	launchUrl?: string;
};

export type BuiltPreview = StandingPreview & { siteId: number; hostname: string };

function wpcomSites( token: string ) {
	const sites = getProviderServices( 'wpcom' ).sites!;
	return { sites, previews: sites.previews!, config: { token } };
}

function toStandingPreview( preview: PreviewSite ): BuiltPreview {
	return {
		siteId: Number( preview.id ),
		hostname: new URL( preview.url ).hostname,
		expiresAt: preview.expiresAt,
		shareUrl: preview.shareUrl,
		liveSiteId: preview.liveSiteId === undefined ? undefined : Number( preview.liveSiteId ),
		launchUrl: preview.launchUrl,
	};
}

function zipContent( archivePath: string ): PushContent {
	return {
		kind: 'archive',
		file: fs.createReadStream( archivePath ),
		name: path.basename( archivePath ),
		size: fs.statSync( archivePath ).size,
	};
}

/**
 * The user's previews WordPress.com still has standing (unpaid and not torn down), by site ID. A
 * preview that was bought, expired or deleted elsewhere is not among them.
 */
export async function getStandingPreviews(
	token: string
): Promise< Map< number, StandingPreview > > {
	const { previews, config } = wpcomSites( token );
	return new Map(
		( await previews.list( config ) ).map( ( preview ) => {
			const { siteId, ...standing } = toStandingPreview( preview );
			return [ siteId, standing ];
		} )
	);
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
): Promise< BuiltPreview > {
	const { sites, previews, config } = wpcomSites( token );
	try {
		if ( 'name' in target ) {
			return toStandingPreview(
				await previews.create(
					config,
					zipContent( archivePath ),
					{ ...options, name: target.name },
					onStatus
				)
			);
		}
		await sites.push(
			config,
			{ id: target.siteId, name: '' },
			zipContent( archivePath ),
			{ preview: options },
			onStatus
		);
		const preview = ( await previews.list( config ) ).find( ( item ) => item.id === target.siteId );
		if ( ! preview?.shareUrl ) {
			throw new LoggerError( __( 'The preview site has no preview link.' ) );
		}
		return toStandingPreview( preview );
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

/** When the preview's content was last edited on WordPress.com (ms). */
export async function getPreviewEditedAt( siteId: number, token: string ): Promise< number > {
	const { sites, config } = wpcomSites( token );
	return sites.editedAt!( config, { id: siteId } );
}

export async function deletePreviewSite( siteId: number, token: string ): Promise< void > {
	const { previews, config } = wpcomSites( token );
	try {
		await previews.delete( config, { id: siteId } );
	} catch ( error ) {
		throw toLoggerError( error, __( 'Failed to delete preview site' ) );
	}
}

/** Deletes the site behind a saved preview, wherever it was made. */
export async function deleteSnapshotSite( snapshot: Snapshot, token: string ): Promise< void > {
	if ( isWpcomPreview( snapshot ) ) {
		await deletePreviewSite( snapshot.atomicSiteId, token );
	} else {
		// A preview made on Jurassic Ninja.
		await deleteSnapshot( snapshot.atomicSiteId, token );
	}
}
