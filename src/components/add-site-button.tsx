import { useI18n } from '@wordpress/react-i18n';
import { useIpcListener } from '../hooks/use-ipc-listener';
import { useSiteDetails } from '../hooks/use-site-details';
import { cx } from '../lib/cx';
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

	useIpcListener( 'add-site', handleClick );

	className = cx(
		'!ring-1 !ring-inset ring-white text-white hover:bg-gray-100 hover:text-black',
		className
	);

	return (
		<Button className={ className } onClick={ handleClick }>
			{ __( 'Add site' ) }
		</Button>
	);
}
