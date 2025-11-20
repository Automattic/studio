import { MenuItem } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { useI18n } from '@wordpress/react-i18n';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { getIpcApi } from 'src/lib/get-ipc-api';

type CopySiteProps = {
	onClose: () => void;
};

const CopySite = ( { onClose }: CopySiteProps ) => {
	const { __ } = useI18n();
	const { selectedSite } = useSiteDetails();

	const isCopyDisabled = ! selectedSite;

	return (
		<MenuItem
			aria-disabled={ isCopyDisabled }
			onClick={ () => {
				if ( isCopyDisabled || ! selectedSite ) {
					return;
				}
				onClose();
				getIpcApi().triggerAddSiteCopy( selectedSite.id );
			} }
			disabled={ isCopyDisabled }
		>
			{ __( 'Copy site' ) }
		</MenuItem>
	);
};
export default CopySite;
