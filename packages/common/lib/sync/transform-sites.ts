import { sitesEndpointSiteSchema } from '@studio/common/types/sync';
import { getSyncSupport, hasStudioPublishingPlan, isPressableSite } from './sync-support';
import type { SitesEndpointSite, SyncSite, SyncSupport } from '@studio/common/types/sync';

export function transformSingleSiteResponse(
	site: SitesEndpointSite,
	syncSupport: SyncSupport,
	pullSupport: SyncSupport,
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
		pullSupport,
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		wpVersion: site.options?.software_version,
		planName: site.plan?.product_name_short,
		hasStudioPublishingPlan: hasStudioPublishingPlan( site ),
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
 * @param options.reprintPull - Whether pulls use Reprint, which needs no plan with the Studio sync
 *                           feature. Push always needs one.
 */
export function transformSitesResponse(
	sites: unknown[],
	options?: {
		connectedSiteIds?: number[];
		onParseError?: ( error: unknown ) => void;
		reprintPull?: boolean;
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
			const pullSupport = options?.reprintPull
				? getSyncSupport( site, connectedSiteIds, { planRequired: false } )
				: syncSupport;

			return transformSingleSiteResponse( site, syncSupport, pullSupport, isStaging );
		} );
}

/**
 * Fills stored connections in from the account's current site list: only the link and the sync
 * times are read from storage. A connection missing from the list was deleted, or the user lost
 * access to it.
 */
export function withWpcomDetails( connections: SyncSite[], wpcomSites: SyncSite[] ): SyncSite[] {
	return connections.map( ( connection ) => {
		const { id, localSiteId, lastPullTimestamp, lastPushTimestamp } = connection;
		const site = wpcomSites.find( ( candidate ) => candidate.id === id );
		const connectedSupport = ( support: SyncSupport | undefined ) =>
			! site ? 'deleted' : support === 'syncable' ? 'already-connected' : support;
		return {
			// A site gone from WordPress.com keeps the name and URL it was connected under.
			...( site ?? connection ),
			localSiteId,
			syncSupport: connectedSupport( site?.syncSupport ) ?? 'deleted',
			pullSupport: connectedSupport( site?.pullSupport ),
			lastPullTimestamp,
			lastPushTimestamp,
		};
	} );
}
