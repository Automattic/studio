import { __ } from '@wordpress/i18n/build-types';
import { useI18n } from '@wordpress/react-i18n';
import Button from 'src/components/button';
import { useSyncSites } from 'src/hooks/sync-sites';
import { useContentTabs } from 'src/hooks/use-content-tabs';
import { useAppDispatch } from 'src/stores';
import { connectedSitesActions, useConnectedSitesData } from 'src/stores/sync';
import { Tooltip } from './tooltip';

export const PublishSiteButton = () => {
	const { __ } = useI18n();
	const dispatch = useAppDispatch();
	const { setSelectedTab } = useContentTabs();
	const { connectedSites } = useConnectedSitesData();
	const { isAnySitePulling, isAnySitePushing } = useSyncSites();
	const isAnySiteSyncing = isAnySitePulling || isAnySitePushing;
	const handlePublishClick = () => {
		setSelectedTab( 'sync' );
		dispatch( connectedSitesActions.openModal( 'push' ) );
	};

	if ( connectedSites.length !== 0 ) return null;

	return (
		<Tooltip
			disabled={ ! isAnySiteSyncing }
			text={ __(
				'Another site is syncing. Please wait for the sync to finish before you publish your site.'
			) }
			placement="left"
		>
			<Button variant="primary" disabled={ isAnySiteSyncing } onClick={ handlePublishClick }>
				{ __( 'Publish site' ) }
			</Button>
		</Tooltip>
	);
};
