import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useAppDispatch } from 'src/stores';
import {
	connectedSitesActions,
	useConnectSiteMutation,
	useGetConnectedSitesForLocalSiteQuery,
} from 'src/stores/sync/connected-sites';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';

export function useListenDeepLinkConnection() {
	const dispatch = useAppDispatch();
	const [ connectSite ] = useConnectSiteMutation();
	const { selectedSite, setSelectedSiteId } = useSiteDetails();
	const { setSelectedTab, selectedTab } = useContentTabs();
	const { user } = useAuth();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite?.id,
		userId: user?.id,
	} );
	const connectedSiteIds = connectedSites.map( ( { id } ) => id );
	const { refetch: refetchWpComSites } = useGetWpComSitesQuery( {
		connectedSiteIds,
		userId: user?.id,
	} );

	useIpcListener(
		'sync-connect-site',
		async ( _event, { remoteSiteId, studioSiteId, autoOpenPush } ) => {
			// Fetch latest sites from network before checking
			const result = await refetchWpComSites();
			const latestSites = result.data ?? [];
			const newConnectedSite = latestSites.find( ( site ) => site.id === remoteSiteId );
			if ( newConnectedSite ) {
				if ( selectedSite?.id && selectedSite.id !== studioSiteId ) {
					// Select studio site that started the sync
					setSelectedSiteId( studioSiteId );
				}
				await connectSite( { site: newConnectedSite, localSiteId: studioSiteId } );
				if ( selectedTab !== 'sync' ) {
					// Switch to sync tab
					setSelectedTab( 'sync' );
				}
				// Only auto-open push dialog if explicitly requested (e.g., from "Publish site" button)
				if ( autoOpenPush ) {
					dispatch( connectedSitesActions.setSelectedRemoteSiteId( remoteSiteId ) );
					dispatch( connectedSitesActions.openModal( 'push' ) );
				}
			}
		}
	);
}
