import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { SyncSite } from 'src/modules/sync/types';
import { useAppDispatch } from 'src/stores';
import { connectedSitesActions, useConnectSiteMutation } from 'src/stores/sync/connected-sites';
import { wpcomSitesApi } from 'src/stores/sync/wpcom-sites';

export function useListenDeepLinkConnection() {
	const dispatch = useAppDispatch();
	const [ connectSite ] = useConnectSiteMutation();
	const { selectedSite, setSelectedSiteId } = useSiteDetails();
	const { setSelectedTab, selectedTab } = useContentTabs();
	const { user } = useAuth();

	useIpcListener(
		'sync-connect-site',
		async (
			_event,
			{
				remoteSiteId,
				studioSiteId,
				autoOpenPush,
				siteName,
				siteUrl,
			}: {
				remoteSiteId: number;
				studioSiteId: string;
				autoOpenPush?: boolean;
				siteName?: string;
				siteUrl?: string;
			}
		) => {
			// Create minimal site object optimistically to connect immediately
			// Use siteName and siteUrl from deeplink if available, otherwise use placeholders
			const minimalSite: SyncSite = {
				id: remoteSiteId,
				localSiteId: studioSiteId,
				name: siteName ?? '', // Will be replaced by fetch; not shown (loading skeleton displayed)
				url: siteUrl ?? '', // Will be replaced by fetch; not shown (loading skeleton displayed)
				isStaging: false, // Placeholder
				isPressable: false, // Placeholder
				environmentType: null, // Will be fetched
				syncSupport: 'already-connected', // Safe default for new connections
				lastPullTimestamp: null, // New site, no history
				lastPushTimestamp: null, // New site, no history
				isLoading: true, // Mark as loading until single-site fetch completes
			};

			// Switch to the site that initiated the connection if needed
			if ( selectedSite?.id && selectedSite.id !== studioSiteId ) {
				setSelectedSiteId( studioSiteId );
			}

			// Switch to sync tab
			if ( selectedTab !== 'sync' ) {
				setSelectedTab( 'sync' );
			}

			const connectPromise = connectSite( { site: minimalSite, localSiteId: studioSiteId } );

			// Only auto-open push dialog if explicitly requested (e.g., from "Publish site" button)
			// Open modal immediately with minimal data
			if ( autoOpenPush ) {
				dispatch( connectedSitesActions.setSelectedRemoteSiteId( remoteSiteId ) );
			}

			const fetchSingleSitePromise = dispatch(
				wpcomSitesApi.endpoints.getSingleWpComSite.initiate( {
					siteId: remoteSiteId,
					userId: user?.id,
				} )
			);

			// Wait for both operations to complete for error handling
			try {
				const [ , singleSiteResult ] = await Promise.all( [
					connectPromise,
					fetchSingleSitePromise,
				] );

				if ( singleSiteResult.data ) {
					const fullSiteData: SyncSite = {
						...singleSiteResult.data,
						localSiteId: studioSiteId,
					};
					await connectSite( { site: fullSiteData, localSiteId: studioSiteId } );
				}

				fetchSingleSitePromise.unsubscribe();
			} catch ( error ) {
				console.error( 'Error during site connection:', error );
				// Connection or refetch failed - the UI will handle the error state via mutation status
			}
		}
	);
}
