import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import type { Snapshot } from '@studio/common/types/snapshot';

// WordPress.com's preview funnel reports its own previews and limit.
const wpcomSnapshotUsageSchema = z
	.object( {
		preview_sites: z.array( z.unknown() ).optional(),
		preview_site_limit: z.number().optional(),
		preview_sites_blocked: z.boolean().optional(),
	} )
	.transform( ( usage ) => ( {
		siteCount: usage.preview_sites?.length ?? 0,
		siteLimit: usage.preview_site_limit ?? 0,
		siteCreationBlocked: usage.preview_sites_blocked ?? false,
	} ) );

export type SnapshotUsage = z.infer< typeof wpcomSnapshotUsageSchema >;

// The link to give out: a WordPress.com preview opens for others only through its preview link.
export function getSnapshotLink( snapshot: Snapshot ): string {
	return snapshot.shareUrl ?? `https://${ snapshot.url }`;
}

// Jurassic Ninja previews made by earlier Studio releases live under this domain.
// Every other preview is a WordPress.com site.
const JURASSIC_NINJA_DOMAIN = '.wp.build';

export function isWpcomPreview( snapshot: Snapshot ): boolean {
	return ! snapshot.url.endsWith( JURASSIC_NINJA_DOMAIN );
}

// When the preview expires (ms): WordPress.com's answer when Studio has one, else a week after its
// last update.
export function getSnapshotExpiry( snapshot: Snapshot ): number {
	return snapshot.expiresAt ?? snapshot.date + DEMO_SITE_EXPIRATION_DAYS * DAY_MS;
}

export function isSnapshotExpired( snapshot: Snapshot ): boolean {
	return getSnapshotExpiry( snapshot ) < Date.now();
}

export function getLatestLinkedPreview(
	snapshots: Snapshot[],
	localSiteId: string,
	liveSiteId: number
): Snapshot | undefined {
	return snapshots
		.filter(
			( snapshot ) => snapshot.localSiteId === localSiteId && snapshot.liveSiteId === liveSiteId
		)
		.reduce< Snapshot | undefined >(
			( latest, snapshot ) =>
				! latest || ( snapshot.syncedAt ?? 0 ) > ( latest.syncedAt ?? 0 ) ? snapshot : latest,
			undefined
		);
}

export function getPreviewPublishWarning( snapshot: Snapshot ): string {
	return sprintf(
		/* translators: %s: preview name or hostname. */
		__(
			'Your site has changed since the preview “%s” was last updated. Publishing will send your current local site, including changes not shown in that preview.'
		),
		snapshot.name || snapshot.url
	);
}

// The account's preview-site count and limit on WordPress.com.
export async function fetchSnapshotUsage( accessToken: string ): Promise< SnapshotUsage > {
	const response = await fetch( 'https://public-api.wordpress.com/wpcom/v2/wow-funnel/pending', {
		headers: { Authorization: `Bearer ${ accessToken }` },
	} );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch snapshot usage: ${ response.status }` );
	}
	return wpcomSnapshotUsageSchema.parse( await response.json() );
}
