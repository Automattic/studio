import { MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useSyncPull } from 'src/hooks/sync-sites/use-sync-pull';
import { useSyncPush } from 'src/hooks/sync-sites/use-sync-push';
import { useDeleteSite } from 'src/hooks/use-delete-site';
import { useSiteDetails } from 'src/hooks/use-site-details';

type DeleteSiteProps = {
	onClose: () => void;
};

const DeleteSite = ( { onClose }: DeleteSiteProps ) => {
	const { __ } = useI18n();
	const { selectedSite, isDeleting } = useSiteDetails();
	const { handleDeleteSite } = useDeleteSite();
	const { isSiteIdPulling } = useSyncPull();
	const { isSiteIdPushing } = useSyncPush();
	const isThisSiteSyncing =
		isSiteIdPulling( selectedSite?.id ?? '' ) || isSiteIdPushing( selectedSite?.id ?? '' );

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
