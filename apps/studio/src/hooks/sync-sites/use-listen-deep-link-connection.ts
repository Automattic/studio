import { SyncSite } from '@studio/common/types/sync';
import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import {
	connectedSitesActions,
	connectedSitesApi,
	useConnectSiteMutation,
	useGetConnectedSitesForLocalSiteQuery,
} from 'src/stores/sync/connected-sites';
import { wpcomSitesApi, useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';

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
		async (
			_event,
			{
				remoteSiteId,
				studioSiteId,
				autoOpenPush,
			}: {
				remoteSiteId: number;
				studioSiteId: string;
				autoOpenPush?: boolean;
			}
		) => {
			// Create minimal site object optimistically to connect immediately
			const minimalSite: SyncSite = {
				id: remoteSiteId,
				localSiteId: studioSiteId,
				name: '',
				url: '',
				isStaging: false,
				isPressable: false,
				environmentType: null,
				syncSupport: 'already-connected',
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			};

			// Switch to the site that initiated the connection if needed
			if ( selectedSite?.id && selectedSite.id !== studioSiteId ) {
				setSelectedSiteId( studioSiteId );
			}

			// Switch to sync tab
			if ( selectedTab !== 'sync' ) {
				setSelectedTab( 'sync' );
			}

			// Mark site as loading in ephemeral Redux state (not persisted to storage)
			dispatch( connectedSitesActions.addLoadingSiteId( remoteSiteId ) );

			const connectPromise = connectSite( { site: minimalSite, localSiteId: studioSiteId } );

			// Only auto-open push dialog if explicitly requested (e.g., from "Publish site" button)
			if ( autoOpenPush ) {
				dispatch(
					connectedSitesActions.setSelectedRemoteSiteId( {
						remoteSiteId,
						localSiteId: studioSiteId,
					} )
				);
			}

			const fetchSingleSitePromise = dispatch(
				wpcomSitesApi.endpoints.getSingleWpComSite.initiate( {
					siteId: remoteSiteId,
					userId: user?.id,
				} )
			);

			// Wait for both operations to complete
			try {
				const [ , singleSiteResult ] = await Promise.all( [
					connectPromise,
					fetchSingleSitePromise,
				] );

				if ( singleSiteResult.data ) {
					const fullSiteData: SyncSite = {
						...singleSiteResult.data,
						localSiteId: studioSiteId,
						syncSupport: 'already-connected',
					};
					await getIpcApi().updateConnectedWpcomSites( [ fullSiteData ] );
					dispatch( connectedSitesApi.util.invalidateTags( [ 'ConnectedSites' ] ) );
				}
			} catch ( error ) {
				console.error( 'Error during site connection:', error );
			} finally {
				fetchSingleSitePromise.unsubscribe();
				dispatch( connectedSitesActions.removeLoadingSiteId( remoteSiteId ) );
			}

			// Refetch all sites to update syncSites (used by the push/pull modal).
			// Fired after clearing the loading state to avoid stale closure issues
			// where the captured refetch references an outdated query subscription.
			void refetchWpComSites();
		}
	);
}
