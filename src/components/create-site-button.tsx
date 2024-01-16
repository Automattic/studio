import { getIpcApi } from '../get-ipc-api';
import { useSiteDetails } from '../hooks/use-site-details';
import Button from './button';

export default function CreateSiteButton() {
	const { createSite } = useSiteDetails();

	const handleClick = async () => {
		const selectedPath = await getIpcApi().showOpenFolderDialog( 'Choose folder for site' );
		if ( selectedPath ) {
			createSite( selectedPath );
		}
	};

	return <Button onClick={ handleClick }>Create site</Button>;
}
