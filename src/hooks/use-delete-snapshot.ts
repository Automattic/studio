import * as Sentry from '@sentry/electron/renderer';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import { useAuth } from './use-auth';
import { useSiteDetails } from './use-site-details';

export function useDeleteSnapshot() {
	const [ isLoading, setIsLoading ] = useState( false );
	const { client } = useAuth();
	const { removeSnapshot } = useSiteDetails();
	const { __ } = useI18n();

	const deleteSnapshot = useCallback(
		async ( snapshot: Pick< Snapshot, 'atomicSiteId' > ) => {
			setIsLoading( true );
			try {
				const response: { message: string } = await client.req.post( {
					path: '/jurassic-ninja/delete',
					apiNamespace: 'wpcom/v2',
					body: { site_id: snapshot.atomicSiteId },
				} );
				removeSnapshot( snapshot );
				return response;
			} catch ( error ) {
				alert( __( 'Error removing shared site.' ) );
				Sentry.captureException( error );
			} finally {
				setIsLoading( false );
			}
		},
		[ __, removeSnapshot, client ]
	);
	return { deleteSnapshot, isLoading };
}
