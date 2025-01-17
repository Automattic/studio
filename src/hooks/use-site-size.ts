import { useState, useEffect } from 'react';
import { DEMO_SITE_SIZE_LIMIT_BYTES } from '../constants';
import { getIpcApi } from '../lib/get-ipc-api';

function formatBytes( bytes: number ): string {
	if ( bytes === 0 ) return '0 B';

	const mb = bytes / ( 1024 * 1024 );
	if ( mb < 1024 ) {
		return `${ mb.toFixed( 2 ) } MB`;
	}

	const gb = mb / 1024;
	return `${ gb.toFixed( 2 ) } GB`;
}

export function useSiteSize( siteId: string ) {
	const [ isOverLimit, setIsOverLimit ] = useState( false );
	const [ formattedSize, setFormattedSize ] = useState( '' );

	useEffect( () => {
		async function checkSiteSize() {
			try {
				const size = await getIpcApi().getSiteSize( siteId );
				console.log( 'site size' + size );
				setIsOverLimit( size > DEMO_SITE_SIZE_LIMIT_BYTES );
				setFormattedSize( formatBytes( size ) );
			} catch ( error ) {
				console.error( 'Error checking site size:', error );
			}
		}
		checkSiteSize();
	}, [ siteId ] );

	return { isOverLimit, formattedSize };
}
