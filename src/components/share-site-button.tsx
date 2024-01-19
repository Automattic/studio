import { useState } from 'react';
import { getIpcApi } from '../get-ipc-api';
import LinkButton from './link-button';

interface ShareSiteButtonProps {
	siteId: string;
}

export default function ShareSiteButton( { siteId }: ShareSiteButtonProps ) {
	const [ isLoading, setIsLoading ] = useState( false );
	const archiveSite = async () => {
		setIsLoading( true );
		await getIpcApi().archiveSite( siteId );
		setIsLoading( false );
	};
	return (
		<LinkButton disabled={ isLoading } onClick={ () => archiveSite() }>
			{ isLoading ? 'Sharing site...' : 'Share site' }
		</LinkButton>
	);
}
