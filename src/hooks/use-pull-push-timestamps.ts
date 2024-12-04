import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useState } from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { SyncSite } from './use-fetch-wpcom-sites';
import { useFormatLocalizedTimestamps } from './use-format-localized-timestamps';
export function usePullPushTimestamps() {
	const [ tooltips, setTooltips ] = useState< Record< string, string > >( {} );
	const { formatRelativeTime } = useFormatLocalizedTimestamps();

	const getLastSyncTimeWithType = useCallback(
		async (
			siteId: string,
			connectedSiteId: number,
			type: 'pull' | 'push',
			sites: SyncSite[]
		): Promise< string > => {
			try {
				const site = sites.find( ( site ) => site.id === connectedSiteId );
				if ( ! site ) return __( 'Site not found.' );

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
					formatRelativeTime( timestamp )
				);
			} catch ( error ) {
				console.error( 'Failed to get sync time:', error );
				return __( 'Unable to determine sync time.' );
			}
		},
		[ formatRelativeTime ]
	);

	const updateTimestamp = useCallback(
		async ( siteId: string, connectedSiteId: number, type: 'pull' | 'push', sites: SyncSite[] ) => {
			try {
				const site = sites.find( ( site ) => site.id === connectedSiteId );
				if ( ! site ) return;

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
		async ( siteId: string, connectedSiteId: number, type: 'pull' | 'push', sites: SyncSite[] ) => {
			const key = `${ siteId }-${ connectedSiteId }-${ type }`;
			const text = await getLastSyncTimeWithType( siteId, connectedSiteId, type, sites );
			setTooltips( ( prev ) => ( { ...prev, [ key ]: text } ) );
		},
		[ getLastSyncTimeWithType ]
	);

	const updateTooltips = useCallback(
		( siteId: string, connectedSites: SyncSite[] ) => {
			connectedSites.forEach( ( site ) => {
				[ 'pull', 'push' ].forEach( ( type ) =>
					getTooltipText( siteId, site.id, type as 'pull' | 'push', connectedSites )
				);
			} );
		},
		[ getTooltipText ]
	);

	const refreshTooltip = useCallback(
		async ( siteId: string, connectedSiteId: number, type: 'pull' | 'push', sites: SyncSite[] ) => {
			await updateTimestamp( siteId, connectedSiteId, type, sites );
			await getTooltipText( siteId, connectedSiteId, type, sites );
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
