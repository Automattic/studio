import { sitesEndpointSiteSchema } from '@studio/common/types/sync';
import { getSyncSupport, isPressableSite } from './sync-support';
import type { SitesEndpointSite, SyncSite, SyncSupport } from '@studio/common/types/sync';

export function isStagingSiteResponse( site: Pick< SitesEndpointSite, 'is_wpcom_staging_site' > ) {
	return site.is_wpcom_staging_site === true;
}

export function transformSingleSiteResponse(
	site: SitesEndpointSite,
	syncSupport: SyncSupport,
	isStaging: boolean,
	relationship?: {
		productionSiteId?: number;
		stagingSiteIds?: number[];
	}
): SyncSite {
	return {
		id: site.ID,
		localSiteId: '',
		name: site.name,
		url: site.URL,
		isStaging,
		productionSiteId: relationship?.productionSiteId,
		stagingSiteIds: relationship?.stagingSiteIds,
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

	const stagingSiteIdsByProductionSiteId = new Map< number, number[] >();
	const productionSiteIdByStagingSiteId = new Map< number, number >();

	validatedSites.forEach( ( site ) => {
		const stagingSiteIds = site.options?.wpcom_staging_blog_ids ?? [];
		if ( stagingSiteIds.length === 0 ) {
			return;
		}

		stagingSiteIdsByProductionSiteId.set( site.ID, stagingSiteIds );
		stagingSiteIds.forEach( ( stagingSiteId ) => {
			if ( ! productionSiteIdByStagingSiteId.has( stagingSiteId ) ) {
				productionSiteIdByStagingSiteId.set( stagingSiteId, site.ID );
			}
		} );
	} );

	return validatedSites
		.filter( ( site ) => ! site.is_a8c )
		.filter(
			( site ) =>
				! site.is_deleted ||
				( connectedSiteIds.length > 0 && connectedSiteIds.some( ( id ) => id === site.ID ) )
		)
		.map( ( site ) => {
			const productionSiteId = productionSiteIdByStagingSiteId.get( site.ID );
			const stagingSiteIds = stagingSiteIdsByProductionSiteId.get( site.ID );
			const isStaging = productionSiteId !== undefined || isStagingSiteResponse( site );
			const syncSupport = getSyncSupport( site, connectedSiteIds );

			return transformSingleSiteResponse( site, syncSupport, isStaging, {
				productionSiteId,
				stagingSiteIds,
			} );
		} );
}
