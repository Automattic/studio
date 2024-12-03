import { __, sprintf } from '@wordpress/i18n';
import { formatDistanceToNow } from 'date-fns';
import { useCallback, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { SyncSite } from './use-fetch-wpcom-sites';

export function usePullPushTimestamps() {
	const [ tooltips, setTooltips ] = useState< Record< string, string > >( {} );

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

	const getTooltipText = useCallback(
		async ( siteId: string, connectedSiteId: number, type: 'pull' | 'push' ) => {
			const key = `${ siteId }-${ connectedSiteId }-${ type }`;
			const text = await getLastSyncTimeWithType( siteId, connectedSiteId, type );
			setTooltips( ( prev ) => ( { ...prev, [ key ]: text } ) );
		},
		[ getLastSyncTimeWithType ]
	);

	const updateTooltips = useCallback(
		( siteId: string, connectedSites: SyncSite[] ) => {
			connectedSites.forEach( ( site ) => {
				getTooltipText( siteId, site.id, 'pull' );
				getTooltipText( siteId, site.id, 'push' );
			} );
		},
		[ getTooltipText ]
	);

	const refreshTooltip = useCallback(
		async ( siteId: string, connectedSiteId: number, type: 'pull' | 'push' ) => {
			await updateTimestamp( siteId, connectedSiteId, type );
			await getTooltipText( siteId, connectedSiteId, type );
		},
		[ updateTimestamp, getTooltipText ]
	);

	return {
		getLastSyncTimeWithType,
		updateTimestamp,
		tooltips,
		updateTooltips,
		refreshTooltip,
	};
}
