import * as Sentry from '@sentry/electron/renderer';
import { useI18n } from '@wordpress/react-i18n';
import { useCallback, useState } from 'react';
import { useAuth } from './use-auth';
import { useSiteDetails } from './use-site-details';

export function useDeleteSnapshot( options: { displayAlert?: boolean } = {} ) {
	const { displayAlert = true } = options;
	const [ isLoading, setIsLoading ] = useState( false );
	const { client } = useAuth();
	const { removeSnapshot } = useSiteDetails();
	const { __ } = useI18n();

	const deleteSnapshot = useCallback(
		async ( snapshot: Pick< Snapshot, 'atomicSiteId' > ) => {
			if ( ! client ) {
				// No-op if logged out
				return;
			}

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
				if ( ( error as WpcomNetworkError )?.code === 'rest_site_already_deleted' ) {
					removeSnapshot( snapshot );
					return;
				}
				if ( displayAlert ) {
					alert( __( 'Error removing preview link.' ) );
				}
				Sentry.captureException( error );
			} finally {
				setIsLoading( false );
			}
		},
		[ __, removeSnapshot, client, displayAlert ]
	);
	return { deleteSnapshot, isLoading };
}
