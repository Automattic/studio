import { getIpcApi } from '../get-ipc-api';
import { Icon, plus } from '@wordpress/icons';
import { useSiteDetails } from '../hooks/use-site-details';
import Button from './button';

interface CreateSiteButtonProps {
	className?: string;
}

export default function CreateSiteButton( { className }: CreateSiteButtonProps ) {
	const { createSite } = useSiteDetails();

	const handleClick = async () => {
		const selectedPath = await getIpcApi().showOpenFolderDialog( 'Choose folder for site' );
		if ( selectedPath ) {
			createSite( selectedPath );
		}
	};

	return (
		<Button variant="secondary" className={ className } onClick={ handleClick }>
			<Icon icon={ plus } />
		</Button>
	);
}
