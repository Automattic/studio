import { cloudUpload } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { generateCheckoutUrl } from 'src/lib/generate-checkout-url';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ConnectButton } from 'src/modules/sync/components/connect-button';
import { useGetConnectedSitesForLocalSiteQuery } from 'src/stores/sync/connected-sites';

export const PublishSiteButton = () => {
	const { __ } = useI18n();
	const isOffline = useOffline();
	const { user } = useAuth();
	const { selectedSite } = useSiteDetails();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite?.id,
		userId: user?.id,
	} );

	const handlePublishClick = useCallback( () => {
		getIpcApi().openURL( generateCheckoutUrl( selectedSite ?? undefined ) );
	}, [ selectedSite ] );

	if ( connectedSites.length !== 0 ) return null;

	return (
		<ConnectButton
			variant="primary"
			icon={ cloudUpload }
			connectSite={ handlePublishClick }
			disabled={ isOffline }
			tooltipText={ __( 'Publishing your site requires an internet connection.' ) }
		>
			{ __( 'Publish site' ) }
		</ConnectButton>
	);
};
