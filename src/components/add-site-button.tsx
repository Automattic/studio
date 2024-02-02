import { useI18n } from '@wordpress/react-i18n';
import { useSiteDetails } from '../hooks/use-site-details';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';

interface AddSiteButtonProps {
	className?: string;
}

export default function AddSiteButton( { className }: AddSiteButtonProps ) {
	const { __ } = useI18n();
	const { createSite } = useSiteDetails();

	const handleClick = async () => {
		const selectedPath = await getIpcApi().showOpenFolderDialog( __( 'Choose folder for site' ) );
		if ( selectedPath ) {
			createSite( selectedPath );
		}
	};

	return (
		<Button variant="primary" className={ className } onClick={ handleClick }>
			{ __( 'Add site' ) }
		</Button>
	);
}
