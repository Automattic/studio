import { sitesEndpointSiteSchema } from '@studio/common/types/sync';
import { getSyncSupport, isPressableSite } from './sync-support';
import type { SitesEndpointSite, SyncSite, SyncSupport } from '@studio/common/types/sync';

export function transformSingleSiteResponse(
	site: SitesEndpointSite,
	syncSupport: SyncSupport,
	isStaging: boolean
): SyncSite {
	return {
		id: site.ID,
		localSiteId: '',
		name: site.name,
		url: site.URL,
		isStaging,
		isPressable: isPressableSite( site ),
		environmentType: site.environment_type,
		syncSupport,
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		wpVersion: site.options?.software_version,
		planName: site.plan?.product_name_short,
		createdAt: site.options?.created_at,
	};
}

/**
 * Transforms the WordPress.com sites API response into SyncSite objects.
 *
 * @param sites - Raw site data from the WordPress.com API
 * @param options.connectedSiteIds - Optional IDs of sites already connected to the current local site.
 *                           When provided, used to: 1) keep deleted sites in the list if they're connected, and
 *                           2) determine sync support status (already-connected vs syncable).
 * @param options.onParseError - Optional callback for site parse errors (e.g. Sentry.captureException)
 */
export function transformSitesResponse(
	sites: unknown[],
	options?: {
		connectedSiteIds?: number[];
		onParseError?: ( error: unknown ) => void;
	}
): SyncSite[] {
	const connectedSiteIds = options?.connectedSiteIds ?? [];

	const validatedSites = sites.reduce< SitesEndpointSite[] >( ( acc, rawSite ) => {
		try {
			return [ ...acc, sitesEndpointSiteSchema.parse( rawSite ) ];
		} catch ( error ) {
			options?.onParseError?.( error );
			return acc;
		}
	}, [] );

	const allStagingSiteIds = validatedSites.flatMap(
		( site ) => site.options?.wpcom_staging_blog_ids ?? []
	);

	return validatedSites
		.filter( ( site ) => ! site.is_a8c )
		.filter(
			( site ) =>
				! site.is_deleted ||
				( connectedSiteIds.length > 0 && connectedSiteIds.some( ( id ) => id === site.ID ) )
		)
		.map( ( site ) => {
			const isStaging = allStagingSiteIds.includes( site.ID );
			const syncSupport = getSyncSupport( site, connectedSiteIds );

			return transformSingleSiteResponse( site, syncSupport, isStaging );
		} );
}

/**
 * Fills stored connections in from the account's current site list. Stored entries only keep the
 * link and sync times current; their name, URL and sync support are a snapshot from connect time.
 * A connection missing from the list was deleted, or the user lost access to it.
 */
export function withWpcomDetails(
	connections: SyncSite[],
	wpcomSites: SyncSite[] | undefined
): SyncSite[] {
	if ( ! wpcomSites ) {
		return connections;
	}
	return connections.map( ( connection ) => {
		const site = wpcomSites.find( ( { id } ) => id === connection.id );
		if ( ! site ) {
			return { ...connection, syncSupport: 'deleted' };
		}
		return {
			...site,
			localSiteId: connection.localSiteId,
			lastPullTimestamp: connection.lastPullTimestamp,
			lastPushTimestamp: connection.lastPushTimestamp,
			syncSupport: site.syncSupport === 'syncable' ? 'already-connected' : site.syncSupport,
		};
	} );
}
