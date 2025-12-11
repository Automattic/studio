import { SyncSite } from 'src/modules/sync/types';

/**
 * Generate updated site data to be stored in `appdata-v1.json`:
 * -- Update the list of `connectedSites` with fresh data (name, URL, etc)
 */
export const reconcileConnectedSites = (
	connectedSites: SyncSite[],
	freshWpComSites: SyncSite[]
): {
	updatedConnectedSites: SyncSite[];
} => {
	const updatedConnectedSites = connectedSites.map( ( connectedSite ): SyncSite => {
		const site = freshWpComSites.find( ( site ) => site.id === connectedSite.id );

		if ( ! site ) {
			return {
				...connectedSite,
				syncSupport: 'deleted',
			};
		}

		return {
			...connectedSite,
			name: site.name,
			url: site.url,
			syncSupport: site.syncSupport,
			isStaging: site.isStaging,
			isPressable: site.isPressable,
			environmentType: site.environmentType,
		};
	}, [] );

	return {
		updatedConnectedSites,
	};
};
