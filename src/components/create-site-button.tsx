import { getIpcApi } from '../get-ipc-api';
import { Icon, plus } from '@wordpress/icons';
import { useSiteDetails } from '../hooks/use-site-details';
import Button from './button';
import { useI18n } from '@wordpress/react-i18n';

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
