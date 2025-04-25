import { useState, useEffect, useCallback } from 'react';
import { DEMO_SITE_SIZE_LIMIT_BYTES } from 'common/constants';
import { useWindowListener } from 'src/hooks/use-window-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';

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
		void checkSiteSize();
	}, [ checkSiteSize ] );

	// Check size when window gains focus
	useWindowListener( 'focus', checkSiteSize );

	return { isOverLimit };
}
