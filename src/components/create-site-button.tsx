import { getIpcApi } from '../get-ipc-api';
import { useSiteDetails } from '../hooks/use-site-details';

export function CreateSiteButton() {
	const { createSite } = useSiteDetails();

	const handleClick = async () => {
		const selectedPath = await getIpcApi().showOpenFolderDialog( 'Choose folder for site' );
		if ( selectedPath ) {
			createSite( selectedPath );
		}
	};

	return (
		<button type="button" className="border-2 px-2 rounded-lg" onClick={ handleClick }>
			Create site
		</button>
	);
}
