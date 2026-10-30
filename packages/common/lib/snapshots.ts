import { z } from 'zod';
import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { isAutomatticianAccount } from '@studio/common/lib/automattician';
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

const jurassicNinjaSnapshotUsageSchema = z
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

export type SnapshotUsage = z.infer< typeof wpcomSnapshotUsageSchema >;

/**
 * Whether new previews are created on WordPress.com rather than on Jurassic Ninja. WordPress.com
 * opens preview sites to Automatticians first, so this is a rollout gate: once it opens them to
 * everyone, it goes away and every new preview is a WordPress.com site.
 */
export function createsPreviewsOnWpcom( accessToken: string ): Promise< boolean > {
	return isAutomatticianAccount( accessToken );
}

// The link to give out: a WordPress.com preview opens for others only through its preview link.
export function getSnapshotLink( snapshot: Snapshot ): string {
	return snapshot.shareUrl ?? `https://${ snapshot.url }`;
}

// Jurassic Ninja previews always live under this domain: those made by earlier Studio releases, and
// those made for accounts outside the WordPress.com rollout. Every other preview is a WordPress.com
// site.
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

// The account's preview-site count and limit, from wherever it creates new previews.
export async function fetchSnapshotUsage( accessToken: string ): Promise< SnapshotUsage > {
	const onWpcom = await createsPreviewsOnWpcom( accessToken );
	const endpoint = onWpcom ? 'wow-funnel/pending' : 'jurassic-ninja/usage';
	const response = await fetch( `https://public-api.wordpress.com/wpcom/v2/${ endpoint }`, {
		headers: { Authorization: `Bearer ${ accessToken }` },
	} );
	if ( ! response.ok ) {
		throw new Error( `Failed to fetch snapshot usage: ${ response.status }` );
	}
	const schema = onWpcom ? wpcomSnapshotUsageSchema : jurassicNinjaSnapshotUsageSchema;
	return schema.parse( await response.json() );
}
