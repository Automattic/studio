import { useEffect, useState } from 'react';
import { DEFAULT_PHP_VERSION } from '../constants';
import { getIpcApi } from '../lib/get-ipc-api';

export function useGetPhpVersion( site: SiteDetails ) {
	const [ phpVersion, setPhpVersion ] = useState( DEFAULT_PHP_VERSION );
	useEffect( () => {
		getIpcApi().getPhpVersion( site.id ).then( setPhpVersion );
	}, [ site.id, site.running, site.phpVersion ] );
	return phpVersion;
}
