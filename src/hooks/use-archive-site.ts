import { useCallback, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useAuth } from './use-auth';
import { useSiteDetails } from './use-site-details';

export function useArchiveSite() {
	const [ isLoading, setIsLoading ] = useState( false );
	const { client } = useAuth();
	const { addSnapshot } = useSiteDetails();

	const archiveSite = useCallback(
		async ( siteId: string ) => {
			setIsLoading( true );
			const { zipContent } = await getIpcApi().archiveSite( siteId );
			const file = new File( [ zipContent ], 'loca-env-site-1.zip', {
				type: 'application/zip',
			} );

			try {
				const response: {
					atomic_site_id: number;
					domain_name: string;
					admin_pass: string;
					admin_user: string;
					job_id: number;
				} = await client.req.post( {
					path: '/jurassic-ninja/create-new-site-from-zip',
					apiNamespace: 'wpcom/v2',
					formData: [ [ 'import', file ] ],
				} );
				console.log( response );
				addSnapshot( {
					url: response.domain_name,
					atomicSiteId: response.atomic_site_id,
					localSiteId: siteId,
					date: new Date().getTime(),
				} );
			} catch ( error ) {
				alert( 'Error sharing site' );
				throw error;
			} finally {
				setIsLoading( false );
			}
		},
		[ client ]
	);
	return { archiveSite, isLoading };
}
