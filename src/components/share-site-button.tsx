import { useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import LinkButton from './link-button';
import { useI18n } from '@wordpress/react-i18n';

interface ShareSiteButtonProps {
	siteId: string;
	disabled?: boolean;
}

export default function ShareSiteButton( { siteId, disabled }: ShareSiteButtonProps ) {
	const { __ } = useI18n();
	const [ isLoading, setIsLoading ] = useState( false );
	const archiveSite = async () => {
		setIsLoading( true );
		await getIpcApi().archiveSite( siteId );
		setIsLoading( false );
	};
	return (
		<LinkButton disabled={ isLoading || disabled } onClick={ () => archiveSite() }>
			{ isLoading ? __( 'Sharing site…' ) : __( 'Share site' ) }
		</LinkButton>
	);
}
