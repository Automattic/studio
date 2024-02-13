import { useEffect, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

export function useGetWpVersion( site: SiteDetails ) {
	const [ wpVersion, setWpVersion ] = useState( '-' );
	useEffect( () => {
		getIpcApi().getWpVersion( site.path ).then( setWpVersion );
	}, [ site.path, site.running ] );
	return wpVersion;
}
