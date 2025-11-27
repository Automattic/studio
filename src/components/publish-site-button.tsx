import { cloudUpload } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback } from 'react';
import Button from 'src/components/button';
import { Tooltip } from 'src/components/tooltip';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useAuth } from 'src/hooks/use-auth';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useAppDispatch } from 'src/stores';
import {
	connectedSitesActions,
	useGetConnectedSitesForLocalSiteQuery,
} from 'src/stores/sync/connected-sites';
import { useGetWpComSitesQuery } from 'src/stores/sync/wpcom-sites';

export const PublishSiteButton = () => {
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
	const { streamlineOnboarding } = useFeatureFlags();

	const connectedSiteIds = connectedSites.map( ( { id } ) => id );
	const { isUninitialized: isUninitializedSyncSites, refetch: refetchWpComSites } =
		useGetWpComSitesQuery(
			{ connectedSiteIds, userId: user?.id },
			{ refetchOnMountOrArgChange: true }
		);

	const isAnySiteSyncing = isAnySitePulling || isAnySitePushing;

	const handlePublishClick = useCallback( () => {
		setSelectedTab( 'sync' );
		if ( isAuthenticated && ! isUninitializedSyncSites ) {
			refetchWpComSites().catch( ( error ) => {
				// Query might not be ready to refetch yet (e.g., was skipped due to offline)
				// Silently ignore the error as the query will start automatically when conditions are met
				console.warn( 'Failed to refetch sites on modal open:', error );
			} );
		}
		dispatch( connectedSitesActions.openModal( 'push' ) );
	}, [ setSelectedTab, dispatch, isAuthenticated, isUninitializedSyncSites, refetchWpComSites ] );

	if ( ! streamlineOnboarding || connectedSites.length !== 0 ) return null;

	return (
		<Tooltip
			disabled={ ! isAnySiteSyncing }
			text={ __(
				'Another site is syncing. Please wait for the sync to finish before you publish your site.'
			) }
			placement="left"
		>
			<Button
				variant="primary"
				disabled={ isAnySiteSyncing }
				aria-label={ __( 'Publish site' ) }
				onClick={ handlePublishClick }
				icon={ cloudUpload }
			>
				{ __( 'Publish site' ) }
			</Button>
		</Tooltip>
	);
};
