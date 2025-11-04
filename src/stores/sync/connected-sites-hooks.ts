import { useCallback } from 'react';
import { useFetchWpComSites } from 'src/hooks/use-fetch-wpcom-sites';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	connectedSitesActions,
	connectedSitesSelectors,
	connectSite,
	disconnectSite,
	loadAllConnectedSites,
} from 'src/stores/sync/connected-sites-slice';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

export const useConnectedSitesData = () => {
	const { selectedSite } = useSiteDetails();
	const localSiteId = selectedSite?.id;
	const connectedSites = useRootSelector( ( state ) =>
		connectedSitesSelectors.selectSitesByLocalSiteId( state, localSiteId )
	);

	return { connectedSites, localSiteId };
};

export const useSyncSitesData = () => {
	const { connectedSites } = useConnectedSitesData();
	const { syncSites, isFetching, refetchSites } = useFetchWpComSites(
		connectedSites.map( ( { id } ) => id )
	);

	return { syncSites, isFetching, refetchSites };
};

export const useConnectedSitesOperations = () => {
	const dispatch = useAppDispatch();
	const { localSiteId, connectedSites } = useConnectedSitesData();

	const connectSiteToLocal = useCallback(
		async ( site: SyncSite, overrideLocalSiteId?: string ) => {
			const targetLocalSiteId = overrideLocalSiteId || localSiteId;

			if ( ! targetLocalSiteId ) {
				throw new Error( 'No local site ID available' );
			}

			try {
				await dispatch(
					connectSite( {
						site,
						localSiteId: targetLocalSiteId,
					} )
				).unwrap();

				dispatch( connectedSitesActions.closeModal() );

				if ( overrideLocalSiteId && overrideLocalSiteId !== localSiteId ) {
					await dispatch( loadAllConnectedSites() );
				}
			} catch ( error ) {
				console.error( 'Failed to connect site:', error );
				throw error;
			}
		},
		[ dispatch, localSiteId ]
	);

	const disconnectSiteFromLocal = useCallback(
		async ( siteId: number ) => {
			if ( ! localSiteId ) {
				throw new Error( 'No local site ID available' );
			}

			try {
				const siteToDisconnect = connectedSites.find( ( site ) => site.id === siteId );

				if ( ! siteToDisconnect ) {
					throw new Error( 'Site not found' );
				}

				await dispatch( disconnectSite( { siteId, localSiteId } ) ).unwrap();
			} catch ( error ) {
				console.error( 'Failed to disconnect site:', error );
				throw error;
			}
		},
		[ dispatch, localSiteId, connectedSites ]
	);

	return {
		connectSite: connectSiteToLocal,
		disconnectSite: disconnectSiteFromLocal,
	};
};
