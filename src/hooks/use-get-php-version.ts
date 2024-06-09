import { useEffect, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

export function useGetPhpVersion( site: SiteDetails ) {
	const [ phpVersion, setPhpVersion ] = useState( '-' );
	useEffect( () => {
		getIpcApi().getPhpVersion( site.id ).then( setPhpVersion );
	}, [ site.id, site.running ] );
	return phpVersion;
}
