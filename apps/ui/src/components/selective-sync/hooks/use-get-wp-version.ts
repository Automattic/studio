import { useCallback, useEffect, useState } from 'react';
import { getIpcApi } from '@/components/selective-sync/lib/get-ipc-api';
import type { SiteDetails } from '@/data/core';

export function useGetWpVersion( site: SiteDetails ) {
	const [ wpVersion, setWpVersion ] = useState( '-' );
	const refreshWpVersion = useCallback( () => {
		void getIpcApi()
			.getWpVersion( site.id )
			.then( ( version ) => setWpVersion( version ?? '-' ) );
	}, [ site.id ] );
	useEffect( () => {
		refreshWpVersion();
	}, [ site.running, refreshWpVersion ] );
	return [ wpVersion, refreshWpVersion ] as const;
}
