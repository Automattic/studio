import { __, sprintf } from '@wordpress/i18n';
import { formatDistanceToNow } from 'date-fns';
import { useCallback } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';

export function usePullPushTimestamps() {
	const getLastSyncTimeWithType = useCallback(
		async ( siteId: string, connectedSiteId: number, type: 'pull' | 'push' ): Promise< string > => {
			try {
				const connectedSites = await getIpcApi().getConnectedWpcomSites( siteId );
				const site = connectedSites.find( ( site ) => site.id === connectedSiteId );

				if ( ! site ) {
					return __( 'Site not found.' );
				}

				const timestamp = type === 'pull' ? site.lastPullTimestamp : site.lastPushTimestamp;

				if ( timestamp === null ) {
					return type === 'pull'
						? __( 'You have not pulled this site yet.' )
						: __( 'You have not pushed this site yet.' );
				}

				return sprintf(
					type === 'pull'
						? __( 'You pulled this site %s ago.' )
						: __( 'You pushed this site %s ago.' ),
					formatDistanceToNow( new Date( timestamp ) )
				);
			} catch ( error ) {
				console.error( 'Failed to get sync time:', error );
				return __( 'Unable to determine sync time.' );
			}
		},
		[]
	);

	const updateTimestamp = useCallback(
		async ( siteId: string, connectedSiteId: number, type: 'pull' | 'push' ) => {
			try {
				const connectedSites = await getIpcApi().getConnectedWpcomSites( siteId );
				const site = connectedSites.find( ( site ) => site.id === connectedSiteId );

				if ( ! site ) {
					return;
				}

				const updatedSite = {
					...site,
					[ type === 'pull' ? 'lastPullTimestamp' : 'lastPushTimestamp' ]: new Date().toISOString(),
				};

				await getIpcApi().updateSingleConnectedWpcomSite( updatedSite );
			} catch ( error ) {
				console.error( 'Failed to update timestamp:', error );
			}
		},
		[]
	);

	return { getLastSyncTimeWithType, updateTimestamp };
}
