import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useAppDispatch } from 'src/stores';
import { connectedSitesActions, useConnectSiteByIdMutation } from 'src/stores/sync/connected-sites';

export function useListenDeepLinkConnection() {
	const dispatch = useAppDispatch();
	const [ connectSiteById ] = useConnectSiteByIdMutation();
	const { selectedSite, setSelectedSiteId } = useSiteDetails();
	const { setSelectedTab, selectedTab } = useContentTabs();
	const { user } = useAuth();

	useIpcListener(
		'sync-connect-site',
		async ( _event, { remoteSiteId, studioSiteId, autoOpenPush } ) => {
			if ( selectedSite?.id && selectedSite.id !== studioSiteId ) {
				// Select studio site that started the sync
				setSelectedSiteId( studioSiteId );
			}
			await connectSiteById( {
				remoteSiteId,
				localSiteId: studioSiteId,
				userId: user?.id,
			} ).unwrap();
			if ( selectedTab !== 'sync' ) {
				// Switch to sync tab
				setSelectedTab( 'sync' );
			}
			// Only auto-open push dialog if explicitly requested (e.g., from "Publish site" button)
			if ( autoOpenPush ) {
				dispatch( connectedSitesActions.setSelectedRemoteSiteId( remoteSiteId ) );
			}
		}
	);
}
