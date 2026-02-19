import { useCallback } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

export function useFindAvailableSiteName() {
	return useCallback( async ( baseName: string ): Promise< string > => {
		const MAX_NAME_ITERATIONS = 500;
		for ( let suffix = 1; suffix < MAX_NAME_ITERATIONS; suffix++ ) {
			const candidateName = suffix === 1 ? baseName : `${ baseName } ${ suffix }`;
			const pathInfo = await getIpcApi().generateProposedSitePath( candidateName );
			if ( pathInfo.isEmpty ) {
				return candidateName;
			}
		}
		return `${ baseName } ${ MAX_NAME_ITERATIONS }`;
	}, [] );
}
