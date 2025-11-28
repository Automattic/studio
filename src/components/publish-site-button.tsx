import { cloudUpload } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback } from 'react';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { ConnectButton } from 'src/modules/sync/components/connect-button';
import { useAppDispatch } from 'src/stores';
import {
	connectedSitesActions,
	useGetConnectedSitesForLocalSiteQuery,
} from 'src/stores/sync/connected-sites';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';

export const PublishSiteButton = ( {
	redirectToSync = true,
}: {
	redirectToSync?: boolean;
} = {} ) => {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const { setSelectedTab } = useContentTabs();
	const { user, isAuthenticated } = useAuth();
	const { selectedSite } = useSiteDetails();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite?.id,
		userId: user?.id,
	} );
	const { isAnySitePulling, isAnySitePushing } = useSyncSites();
	const connectedSiteIds = connectedSites.map( ( { id } ) => id );
	const {
		isUninitialized: isUninitializedSyncSites,
		isFetching: isFetchingSyncSites,
		refetch: refetchWpComSites,
	} = useGetWpComSitesQuery( { connectedSiteIds, userId: user?.id } );
	const isAnySiteSyncing = isAnySitePulling || isAnySitePushing;

	const handlePublishClick = useCallback( () => {
		if ( redirectToSync ) {
			setSelectedTab( 'sync' );
		}
		if ( isAuthenticated && ! isUninitializedSyncSites ) {
			// Refetch sites on the background but ignore errors
			void refetchWpComSites();
		}
		dispatch( connectedSitesActions.openModal( 'push' ) );
	}, [
		redirectToSync,
		setSelectedTab,
		dispatch,
		isAuthenticated,
		isUninitializedSyncSites,
		refetchWpComSites,
	] );

	// Don't show the button if there are already connected sites
	// (only when redirectToSync is true, meaning it's used outside the sync tab)
	if ( redirectToSync && connectedSites.length !== 0 ) return null;

	return (
		<ConnectButton
			variant="primary"
			icon={ cloudUpload }
			connectSite={ handlePublishClick }
			disabled={ isAnySiteSyncing }
			isBusy={ isFetchingSyncSites }
			tooltipText={
				isAnySiteSyncing
					? __(
							'Another site is syncing. Please wait for the sync to finish before you publish your site.'
					  )
					: __( 'Publishing your site requires an internet connection.' )
			}
		>
			{ __( 'Publish site' ) }
		</ConnectButton>
	);
};
