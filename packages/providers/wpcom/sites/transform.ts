import { sitesEndpointSiteSchema, type SitesEndpointSite } from './schemas';
import { getSyncSupport, pushNeedsUpgrade, isPressableSite } from './support';
import type { SyncSite, SyncSupport } from '../site';

function transformSingleSiteResponse(
	site: SitesEndpointSite,
	syncSupport: SyncSupport,
	isStaging: boolean
): SyncSite {
	return {
		id: site.ID,
		localSiteId: '',
		name: site.name,
		url: site.URL,
		launchStatus: site.launch_status,
		isComingSoon: site.is_coming_soon,
		isPrivate: site.is_private,
		isStaging,
		isPressable: isPressableSite( site ),
		environmentType: site.environment_type,
		syncSupport,
		lastPullTimestamp: null,
		lastPushTimestamp: null,
		wpVersion: site.options?.software_version,
		planName: site.plan?.product_name_short,
		pushNeedsUpgrade: pushNeedsUpgrade( site ),
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
 * @param options.planRequired - Whether syncing needs a plan with the Studio sync feature. Defaults
 *                           to true; a Reprint pull passes false.
 */
export function transformSitesResponse(
	sites: unknown[],
	options?: {
		connectedSiteIds?: number[];
		onParseError?: ( error: unknown ) => void;
		planRequired?: boolean;
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
			const syncSupport = getSyncSupport( site, connectedSiteIds, {
				planRequired: options?.planRequired,
			} );

			return transformSingleSiteResponse( site, syncSupport, isStaging );
		} );
}
