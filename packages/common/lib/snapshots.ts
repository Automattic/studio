import { z } from 'zod';
import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import type { Snapshot } from '@studio/common/types/snapshot';

const snapshotUsageSchema = z
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

export type SnapshotUsage = z.infer< typeof snapshotUsageSchema >;

// The link to give out: a WordPress.com preview opens for others only through its preview link.
export function getSnapshotLink( snapshot: Snapshot ): string {
	return snapshot.shareUrl ?? `https://${ snapshot.url }`;
}

export function isSnapshotExpired( snapshot: Snapshot ): boolean {
	return snapshot.date + DEMO_SITE_EXPIRATION_DAYS * DAY_MS < Date.now();
}

// The account's preview-site count and limit on WordPress.com. A user its preview funnel does not
// admit has no limit.
export async function fetchSnapshotUsage( accessToken: string ): Promise< SnapshotUsage > {
	const response = await fetch( 'https://public-api.wordpress.com/wpcom/v2/wow-funnel/pending', {
		headers: { Authorization: `Bearer ${ accessToken }` },
	} );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch snapshot usage: ${ response.status }` );
	}
	return snapshotUsageSchema.parse( await response.json() );
}
