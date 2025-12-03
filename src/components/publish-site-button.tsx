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

export const PublishSiteButton = () => {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const { setSelectedTab } = useContentTabs();
	const { user, authenticate } = useAuth();
	const { selectedSite } = useSiteDetails();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite?.id,
		userId: user?.id,
	} );
	const { isAnySitePulling, isAnySitePushing } = useSyncSites();
	const isAnySiteSyncing = isAnySitePulling || isAnySitePushing;

	const handlePublishClick = useCallback( () => {
		setSelectedTab( 'sync' );
		if ( ! user ) {
			authenticate();
		} else {
			dispatch( connectedSitesActions.openModal( 'push' ) );
		}
	}, [ user, setSelectedTab, dispatch, authenticate ] );

	if ( connectedSites.length !== 0 ) return null;

	return (
		<ConnectButton
			variant="primary"
			icon={ cloudUpload }
			connectSite={ handlePublishClick }
			disabled={ isAnySiteSyncing }
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
