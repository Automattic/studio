import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useConnectSiteMutation } from 'src/stores/sync/connected-sites';

export function useListenDeepLinkConnection() {
	const [ connectSite ] = useConnectSiteMutation();
	const { selectedSite, setSelectedSiteId } = useSiteDetails();
	const { setSelectedTab, selectedTab } = useContentTabs();
	const { user } = useAuth();

	useIpcListener( 'sync-connect-site', async ( _event, { remoteSiteId, studioSiteId } ) => {
		if ( selectedSite?.id && selectedSite.id !== studioSiteId ) {
			// Select studio site that started the sync
			setSelectedSiteId( studioSiteId );
		}
		await connectSite( { remoteSiteId, localSiteId: studioSiteId, userId: user?.id } );
		if ( selectedTab !== 'sync' ) {
			// Switch to sync tab
			setSelectedTab( 'sync' );
		}
	} );
}
