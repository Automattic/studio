import { useCallback, useEffect, useState } from 'react';
import { getIpcApi } from '@/components/selective-sync/lib/get-ipc-api';
import type { SiteDetails } from '@/data/core';

export function useIsMultisite( site: SiteDetails ) {
	const [ isMultisite, setIsMultisite ] = useState( false );
	const refresh = useCallback( () => {
		void getIpcApi()
			.getIsMultisite( site.id )
			.then( ( value ) => setIsMultisite( value ?? false ) );
	}, [ site.id ] );
	useEffect( () => {
		refresh();
	}, [ site.running, refresh ] );
	return isMultisite;
}
