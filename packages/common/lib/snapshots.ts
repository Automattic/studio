import { RemoteSiteError } from '@studio/providers';
import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import type { Snapshot } from '@studio/common/types/snapshot';
import type {
	PreviewOptions,
	PreviewSite,
	PushContent,
	PushStatus,
	RemoteSite,
	SitesServices,
} from '@studio/providers';

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

/**
 * Builds a preview from a local site's content: a new one, or `siteId`'s again, which is a push to
 * it. Resolves with the preview once it has its preview link. Hosts pass in the provider's sites,
 * from `@studio/providers/services`.
 */
export async function buildPreview< Config, Site extends RemoteSite >(
	sites: SitesServices< Config, Site >,
	config: Config,
	content: PushContent,
	target: { siteId: Site[ 'id' ] } | { name: string },
	options: PreviewOptions,
	onStatus: ( status: PushStatus ) => void
): Promise< PreviewSite > {
	if ( ! sites.previews ) {
		throw new RemoteSiteError( __( 'This provider doesn’t make previews.' ) );
	}
	if ( 'name' in target ) {
		return sites.previews.create( config, content, { ...options, name: target.name }, onStatus );
	}
	await sites.push(
		config,
		{ id: target.siteId, name: '' } as Pick< Site, 'id' | 'name' > & Partial< Site >,
		content,
		{ preview: options },
		onStatus
	);
	const preview = ( await sites.previews.list( config ) ).find(
		( item ) => item.id === target.siteId
	);
	if ( ! preview?.shareUrl ) {
		throw new RemoteSiteError( __( 'The preview site has no preview link.' ) );
	}
	return preview;
}

// Jurassic Ninja previews made by earlier Studio releases live under this domain. They expire a
// week after they were last updated. Every other preview is a WordPress.com site.
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

// WordPress.com uses its own copy of the default themes, so edits to their files don't reach a preview.
// The first sentence is what a notice shows on its one line before it's expanded, so keep it short
// and complete.
export function getEditedDefaultThemesWarning( themes: string[] ): string {
	return sprintf(
		/* translators: %s: theme names, e.g. "Twenty Twenty-Five". Keep the first sentence short: notices show only its first line until expanded. */
		__(
			'Theme file edits won’t show. Your changes to %s’s files are left out: this preview uses WordPress.com’s original copy of the theme. Make them in the Site Editor or a child theme to see them in previews.'
		),
		themes.join( ', ' )
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
