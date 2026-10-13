import { z } from 'zod';
import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import type { Snapshot } from '@studio/common/types/snapshot';

const snapshotUsageSchema = z
	.object( {
		site_count: z.number(),
		site_limit: z.number(),
		site_creation_blocked: z.boolean(),
	} )
	.transform( ( usage ) => ( {
		siteCount: usage.site_count,
		siteLimit: usage.site_limit,
		siteCreationBlocked: usage.site_creation_blocked,
	} ) );

export type SnapshotUsage = z.infer< typeof snapshotUsageSchema >;

export function isSnapshotExpired( snapshot: Snapshot ): boolean {
	return snapshot.date + DEMO_SITE_EXPIRATION_DAYS * DAY_MS < Date.now();
}

// The account's preview-site count and limit on WordPress.com.
export async function fetchSnapshotUsage( accessToken: string ): Promise< SnapshotUsage > {
	const response = await fetch( 'https://public-api.wordpress.com/wpcom/v2/jurassic-ninja/usage', {
		headers: { Authorization: `Bearer ${ accessToken }` },
	} );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch snapshot usage: ${ response.status }` );
	}
	return snapshotUsageSchema.parse( await response.json() );
}
