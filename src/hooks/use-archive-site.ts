import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useEffect, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useAuth } from './use-auth';
import { useSiteDetails } from './use-site-details';

export function useArchiveSite() {
	const [ isLoading, setIsLoading ] = useState( false );
	const { client } = useAuth();
	const { __ } = useI18n();
	const { snapshots, addSnapshot, updateSnapshot } = useSiteDetails();

	useEffect( () => {
		const loadingSnapshots = snapshots.filter( ( snapshot ) => snapshot.isLoading );
		if ( loadingSnapshots.length === 0 ) {
			return;
		}
		const intervalId = setInterval( async () => {
			for ( const snapshot of loadingSnapshots ) {
				if ( snapshot.isLoading ) {
					const response: {
						domain_name: string;
						atomic_site_id: number;
						status: '1' | '2';
					} = await client.req.get( '/jurassic-ninja/status', {
						apiNamespace: 'wpcom/v2',
						site_id: snapshot.atomicSiteId,
					} );
					if ( parseInt( response.status ) === 2 ) {
						updateSnapshot( {
							...snapshot,
							isLoading: false,
						} );
					}
				}
			}
		}, 3000 );
		return () => {
			clearInterval( intervalId );
		};
	}, [ client, snapshots, updateSnapshot ] );

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
					isLoading: true,
				} );
			} catch ( error ) {
				alert( __( 'Error sharing site' ) );
				throw error;
			} finally {
				setIsLoading( false );
			}
		},
		[ __, addSnapshot, client ]
	);
	return { archiveSite, isLoading };
}
