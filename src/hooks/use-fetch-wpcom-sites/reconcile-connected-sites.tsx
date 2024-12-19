import { SyncSite } from './types';

/**
 * Generate updated site data to be stored in `appdata-v1.json` in three steps:
 *   1. Update the list of `connectedSites` with fresh data (name, URL, etc)
 *   2. Find any staging sites that have been added to an already connected site
 *   3. Find any connected staging sites that have been deleted on WordPress.com
 *
 * We treat staging sites differently from production sites because users can't connect staging
 * sites separately from production sites (they're always connected together). So, while deleted
 * production sites are still rendered in the UI (with a "deleted" notice), we need to automatically
 * keep the list of staging sites up-to-date, which is where `stagingSitesToAdd` and
 * `stagingSitesToDelete` comes in.
 */
export const reconcileConnectedSites = (
	connectedSites: SyncSite[],
	freshWpComSites: SyncSite[]
): {
	updatedConnectedSites: SyncSite[];
	stagingSitesToAdd: SyncSite[];
	stagingSitesToDelete: { id: number; localSiteId: string }[];
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
			stagingSiteIds: site.stagingSiteIds,
		};
	}, [] );

	const stagingSitesToAdd = connectedSites.flatMap( ( connectedSite ) => {
		const updatedConnectedSite = updatedConnectedSites.find(
			( site ) => site.id === connectedSite.id
		);

		if ( ! updatedConnectedSite?.stagingSiteIds.length ) {
			return [];
		}

		const addedStagingSiteIds = updatedConnectedSite.stagingSiteIds.filter(
			( id ) => ! connectedSite.stagingSiteIds.includes( id )
		);

		return addedStagingSiteIds.flatMap( ( id ): SyncSite[] => {
			const freshSite = freshWpComSites.find( ( site ) => site.id === id );

			if ( ! freshSite ) {
				return [];
			}

			return [
				{
					...freshSite,
					localSiteId: connectedSite.localSiteId,
					syncSupport: 'already-connected',
				},
			];
		}, [] );
	} );

	const stagingSitesToDelete = connectedSites.flatMap( ( connectedSite ) => {
		const updatedConnectedSite = updatedConnectedSites.find(
			( site ) => site.id === connectedSite.id
		);

		if ( ! connectedSite?.stagingSiteIds.length ) {
			return [];
		}

		return connectedSite.stagingSiteIds
			.filter( ( id ) => ! updatedConnectedSite?.stagingSiteIds.includes( id ) )
			.map( ( id ) => {
				return {
					id,
					localSiteId: connectedSite.localSiteId,
				};
			} );
	} );

	return {
		updatedConnectedSites,
		stagingSitesToAdd,
		stagingSitesToDelete,
	};
};
