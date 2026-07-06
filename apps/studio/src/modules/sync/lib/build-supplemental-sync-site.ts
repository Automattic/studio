import { getSyncSupport } from '@studio/common/lib/sync/sync-support';
import { transformSingleSiteResponse } from '@studio/common/lib/sync/transform-sites';
import type { SitesEndpointSite, SyncSite } from '@studio/common/types/sync';

/**
 * Builds the SyncSite for a connected site fetched individually via
 * rest/v1.1 /sites/{id} (the reconciliation fallback for sites beyond
 * page 1 of /me/sites).
 *
 * That endpoint omits the wpcom-only fields /me/sites responses are
 * decorated with (hosting_provider_guess, environment_type), even when
 * explicitly requested. Missing provider metadata therefore must not
 * downgrade a stored Pressable or staging site (STU-1944); deletion and
 * permission changes are still detected from the response.
 */
export function buildSupplementalSyncSite(
	site: SitesEndpointSite,
	storedSite: SyncSite | undefined,
	connectedSiteIds: number[]
): SyncSite {
	const effectiveSite =
		site.hosting_provider_guess === undefined && storedSite?.isPressable
			? { ...site, hosting_provider_guess: 'pressable' }
			: site;

	const syncSupport = getSyncSupport( effectiveSite, connectedSiteIds );
	const isStaging = effectiveSite.environment_type
		? effectiveSite.environment_type === 'staging' ||
		  effectiveSite.environment_type === 'development'
		: storedSite?.isStaging ?? false;

	const syncSite = transformSingleSiteResponse( effectiveSite, syncSupport, isStaging );
	return {
		...syncSite,
		environmentType: syncSite.environmentType ?? storedSite?.environmentType,
	};
}
