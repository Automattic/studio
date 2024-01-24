import { useState } from 'react';
import { getIpcApi } from '../get-ipc-api';
import LinkButton from './link-button';

interface ShareSiteButtonProps {
	siteId: string;
	disabled?: boolean;
}

export default function ShareSiteButton( { siteId, disabled }: ShareSiteButtonProps ) {
	const [ isLoading, setIsLoading ] = useState( false );
	const archiveSite = async () => {
		setIsLoading( true );
		await getIpcApi().archiveSite( siteId );
		setIsLoading( false );
	};
	return (
		<LinkButton disabled={ isLoading || disabled } onClick={ () => archiveSite() }>
			{ isLoading ? 'Sharing site...' : 'Share site' }
		</LinkButton>
	);
}
