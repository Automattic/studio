import { MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useDeleteSite } from 'src/hooks/use-delete-site';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { store } from 'src/stores';
import { syncOperationsSelectors } from 'src/stores/sync';

type DeleteSiteProps = {
	onClose: () => void;
};

const DeleteSite = ( { onClose }: DeleteSiteProps ) => {
	const { __ } = useI18n();
	const { selectedSite, isDeleting } = useSiteDetails();
	const { handleDeleteSite } = useDeleteSite();
	const isThisSiteSyncing =
		syncOperationsSelectors.selectIsSiteIdPulling( selectedSite?.id ?? '' )( store.getState() ) ||
		syncOperationsSelectors.selectIsSiteIdPushing( selectedSite?.id ?? '' )( store.getState() );

	const isSiteDeletionDisabled = ! selectedSite || isDeleting || isThisSiteSyncing;

	return (
		<MenuItem
			aria-disabled={ isSiteDeletionDisabled }
			onClick={ () => {
				if ( isSiteDeletionDisabled || ! selectedSite ) {
					return;
				}
				onClose();
				void handleDeleteSite( selectedSite.id, selectedSite.name );
			} }
			isDestructive
			disabled={ isSiteDeletionDisabled }
		>
			{ __( 'Delete site' ) }
		</MenuItem>
	);
};
export default DeleteSite;
