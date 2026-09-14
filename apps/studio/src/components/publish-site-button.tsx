import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { cloudUpload } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback } from 'react';
import { useAuth } from 'src/hooks/use-auth';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { recordRendererTracksEvent } from 'src/lib/analytics';
import { generateCheckoutUrl } from 'src/lib/generate-checkout-url';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { ConnectButton } from 'src/modules/sync/components/connect-button';
import { useRootSelector } from 'src/stores';
import { syncOperationsSelectors } from 'src/stores/sync';
import { useGetConnectedSitesForLocalSiteQuery } from 'src/stores/sync/connected-sites';

export const PublishSiteButton = () => {
	const { __ } = useI18n();
	const { user } = useAuth();
	const { selectedSite } = useSiteDetails();
	const { data: connectedSites = [] } = useGetConnectedSitesForLocalSiteQuery( {
		localSiteId: selectedSite?.id,
		userId: user?.id,
	} );
	const isAnySiteDoingLocalSyncWork = useRootSelector(
		syncOperationsSelectors.selectIsAnySiteDoingLocalSyncWork
	);

	const handlePublishClick = useCallback( () => {
		if ( ! selectedSite ) return;
		// Fires at the handoff to WordPress.com checkout, not at completion — the
		// site coming back is a later `studio_sync_connect` deep link.
		recordRendererTracksEvent( TRACKS_EVENTS.SYNC_PUBLISH_SITE );
		getIpcApi().openURL(
			generateCheckoutUrl( selectedSite, 'publish-site', { autoOpenPush: true } )
		);
	}, [ selectedSite ] );

	if ( ! selectedSite || connectedSites.length !== 0 ) return null;

	return (
		<ConnectButton
			variant="primary"
			icon={ cloudUpload }
			connectSite={ handlePublishClick }
			disabled={ isAnySiteDoingLocalSyncWork }
			tooltipText={
				isAnySiteDoingLocalSyncWork
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
