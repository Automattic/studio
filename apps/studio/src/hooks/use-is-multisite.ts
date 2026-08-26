import { useCallback, useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

export function useIsMultisite( site: SiteDetails ) {
	const [ isMultisite, setIsMultisite ] = useState( false );
	const refresh = useCallback( () => {
		void getIpcApi().getIsMultisite( site.id ).then( setIsMultisite );
	}, [ site.id ] );
	useEffect( () => {
		refresh();
	}, [ site.running, refresh ] );
	return isMultisite;
}
