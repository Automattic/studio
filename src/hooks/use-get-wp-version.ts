import { useEffect, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

export function useGetWpVersion( site: SiteDetails ) {
	const [ wpVersion, setWpVersion ] = useState( '-' );
	useEffect( () => {
		getIpcApi().getWpVersion( site.id ).then( setWpVersion );
	}, [ site.id, site.running ] );
	return wpVersion;
}
