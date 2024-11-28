import { useContentTabs } from '../use-content-tabs';
import { transformSingleSiteResponse } from '../use-fetch-wpcom-sites';
import { useIpcListener } from '../use-ipc-listener';
import { useSiteDetails } from '../use-site-details';
import { SyncSitesContextType } from './sync-sites-context';

export function useListenDeepLinkConnection( {
	connectSite,
	refetchSites,
}: {
	connectSite: SyncSitesContextType[ 'connectSite' ];
	refetchSites: SyncSitesContextType[ 'refetchSites' ];
} ) {
	const { selectedSite, setSelectedSiteId } = useSiteDetails();
	const { setSelectedTab, selectedTab } = useContentTabs();

	useIpcListener(
		'sync-connect-site',
		async (
			_event,
			{ remoteSiteId, studioSiteId }: { remoteSiteId: number; studioSiteId: string }
		) => {
			// Fetch latest sites from network before checking
			const latestSites = await refetchSites();
			const newConnectedSiteResponse = latestSites.find( ( site ) => site.ID === remoteSiteId );
			if ( newConnectedSiteResponse ) {
				if ( selectedSite?.id && selectedSite.id !== studioSiteId ) {
					// Select studio site that started the sync
					setSelectedSiteId( studioSiteId );
				}
				const newConnectedSite = transformSingleSiteResponse(
					newConnectedSiteResponse,
					'already-connected'
				);
				await connectSite( newConnectedSite, studioSiteId );
				if ( selectedTab !== 'sync' ) {
					// Switch to sync tab
					setSelectedTab( 'sync' );
				}
			}
		}
	);
}
