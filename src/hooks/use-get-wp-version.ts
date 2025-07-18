import { useCallback, useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

export function useGetWpVersion( site: SiteDetails ) {
	const [ wpVersion, setWpVersion ] = useState( '-' );
	const refreshWpVersion = useCallback( () => {
		void getIpcApi().getWpVersion( site.id ).then( setWpVersion );
	}, [ site.id ] );
	useEffect( () => {
		refreshWpVersion();
	}, [ site.running, refreshWpVersion ] );
	return [ wpVersion, refreshWpVersion ] as const;
}
