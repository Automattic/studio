import { SyncSite } from '@studio/common/types/sync';

/**
 * Generate updated site data to be stored in `appdata-v1.json`:
 * -- Update the list of `connectedSites` with fresh data (name, URL, etc)
 *
 * A connected site only gets marked `deleted` when its ID is in
 * `verifiedDeletedIds`. A site missing from `freshWpComSites` alone is not
 * enough — it may simply be on a later page of /me/sites, and we don't want
 * to flag a freshly-connected site as deleted because of pagination.
 */
export const reconcileConnectedSites = (
	connectedSites: SyncSite[],
	freshWpComSites: SyncSite[],
	verifiedDeletedIds: Set< number > = new Set()
): {
	updatedConnectedSites: SyncSite[];
} => {
	const updatedConnectedSites = connectedSites.map( ( connectedSite ): SyncSite => {
		const site = freshWpComSites.find( ( site ) => site.id === connectedSite.id );

		if ( site ) {
			return {
				...connectedSite,
				name: site.name,
				url: site.url,
				syncSupport: site.syncSupport,
				isStaging: site.isStaging,
				isPressable: site.isPressable,
				environmentType: site.environmentType,
			};
		}

		if ( verifiedDeletedIds.has( connectedSite.id ) ) {
			return {
				...connectedSite,
				syncSupport: 'deleted',
			};
		}

		return connectedSite;
	}, [] );

	return {
		updatedConnectedSites,
	};
};
