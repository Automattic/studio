import { useContentTabs } from '../use-content-tabs';
import { SyncSite } from '../use-fetch-wpcom-sites';
import { useIpcListener } from '../use-ipc-listener';
import { useSiteDetails } from '../use-site-details';
import { SyncSitesContextType } from './sync-sites-context';

export function useListenDeepLinkConnection( {
	connectSite,
	syncSites,
}: {
	connectSite: SyncSitesContextType[ 'connectSite' ];
	syncSites: SyncSite[];
} ) {
	const { selectedSite, setSelectedSiteId } = useSiteDetails();
	const { setSelectedTab, selectedTab } = useContentTabs();

	useIpcListener( 'sync-connect-site', async ( _event, { remoteSiteId, studioSiteId } ) => {
		const newConnectedSite = syncSites.find( ( site ) => site.id === remoteSiteId );
		if ( newConnectedSite ) {
			await connectSite( newConnectedSite, studioSiteId );
			if ( selectedSite?.id && selectedSite.id !== remoteSiteId ) {
				// Select recently connected site that started the sync
				setSelectedSiteId( studioSiteId );
			}
			if ( selectedTab !== 'sync' ) {
				console.log( 'Switching to sync tab', { selectedTab } );
				// Switch to sync tab
				setSelectedTab( 'sync' );
			}
		}
	} );
}
