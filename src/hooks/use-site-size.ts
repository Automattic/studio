import { useState, useEffect, useCallback } from 'react';
import { DEMO_SITE_SIZE_LIMIT_BYTES } from '../constants';
import { getIpcApi } from '../lib/get-ipc-api';
import { useWindowListener } from './use-window-listener';

export function useSiteSize( siteId: string ) {
	const [ isOverLimit, setIsOverLimit ] = useState( false );

	const checkSiteSize = useCallback( async () => {
		if ( ! siteId ) {
			return;
		}

		try {
			const size = await getIpcApi().getWpContentSize( siteId );
			setIsOverLimit( size > DEMO_SITE_SIZE_LIMIT_BYTES );
		} catch ( error ) {
			console.error( 'Error checking site size:', error );
		}
	}, [ siteId ] );

	// Check size when siteId changes
	useEffect( () => {
		checkSiteSize();
	}, [ checkSiteSize ] );

	// Check size when window gains focus
	useWindowListener( 'focus', checkSiteSize );

	return { isOverLimit };
}
