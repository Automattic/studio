import { SyncSitesContextType } from 'src/hooks/sync-sites/sync-sites-context';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useConnectSiteMutation } from 'src/stores/sync/connected-sites';

export function useListenDeepLinkConnection( {
	refetchSites,
}: {
	refetchSites: SyncSitesContextType[ 'refetchSites' ];
} ) {
	const [ connectSite ] = useConnectSiteMutation();
	const { selectedSite, setSelectedSiteId } = useSiteDetails();
	const { setSelectedTab, selectedTab } = useContentTabs();

	useIpcListener( 'sync-connect-site', async ( _event, { remoteSiteId, studioSiteId } ) => {
		// Fetch latest sites from network before checking
		const latestSites = await refetchSites();
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
		}
	} );
}
