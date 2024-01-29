import { Icon, plus } from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import { useSiteDetails } from '../hooks/use-site-details';
import { getIpcApi } from '../lib/get-ipc-api';
import Button from './button';

interface CreateSiteButtonProps {
	className?: string;
}

export default function CreateSiteButton( { className }: CreateSiteButtonProps ) {
	const { __ } = useI18n();
	const { createSite } = useSiteDetails();

	const handleClick = async () => {
		const selectedPath = await getIpcApi().showOpenFolderDialog( __( 'Choose folder for site' ) );
		if ( selectedPath ) {
			createSite( selectedPath );
		}
	};

	return (
		<Button
			variant="secondary"
			className={ className }
			onClick={ handleClick }
			aria-label={ __( 'Create site' ) }
		>
			<Icon icon={ plus } />
		</Button>
	);
}
