import { useState, useEffect } from 'react';
import { DEMO_SITE_SIZE_LIMIT_BYTES } from '../constants';
import { getIpcApi } from '../lib/get-ipc-api';

export function useSiteSize( siteId: string ) {
	const [ isOverLimit, setIsOverLimit ] = useState( false );

	useEffect( () => {
		async function checkSiteSize() {
			try {
				const size = await getIpcApi().getSiteSize( siteId );
				setIsOverLimit( size > DEMO_SITE_SIZE_LIMIT_BYTES );
			} catch ( error ) {
				console.error( 'Error checking site size:', error );
			}
		}
		checkSiteSize();
	}, [ siteId ] );

	return { isOverLimit };
}
