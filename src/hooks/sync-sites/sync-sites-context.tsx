import { __, sprintf } from '@wordpress/i18n';
import React, { createContext, useCallback, useContext, useState } from 'react';
import { getIpcApi } from '../../lib/get-ipc-api';
import { useFormatLocalizedTimestamps } from '../use-format-localized-timestamps';
import { useListenDeepLinkConnection } from './use-listen-deep-link-connection';
import { UseSiteSyncManagement, useSiteSyncManagement } from './use-site-sync-management';
import { PullStates, UseSyncPull, useSyncPull } from './use-sync-pull';
import { PushStates, UseSyncPush, useSyncPush } from './use-sync-push';
import type { SyncSite } from '../use-fetch-wpcom-sites/types';

type GetLastSyncTimeText = ( timestamp: string | null, type: 'pull' | 'push' ) => string;
type UpdateSiteTimestamp = (
	siteId: number | undefined,
	localSiteId: string,
	type: 'pull' | 'push'
) => Promise< void >;

export type SyncSitesContextType = Omit< UseSyncPull, 'pullStates' > &
	Omit< UseSyncPush, 'pushStates' > &
	Omit< UseSiteSyncManagement, 'loadConnectedSites' > & {
		getLastSyncTimeText: GetLastSyncTimeText;
	};

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const { formatRelativeTime } = useFormatLocalizedTimestamps();
	const [ pullStates, setPullStates ] = useState< PullStates >( {} );
	const [ connectedSites, setConnectedSites ] = useState< SyncSite[] >( [] );

	const getLastSyncTimeText = useCallback< GetLastSyncTimeText >(
		( timestamp, type ) => {
			if ( ! timestamp ) {
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
		},
		[ formatRelativeTime ]
	);

	const updateSiteTimestamp = useCallback< UpdateSiteTimestamp >(
		async ( siteId, localSiteId, type ) => {
			const site = connectedSites.find(
				( { id, localSiteId: siteLocalId } ) => siteId === id && localSiteId === siteLocalId
			);

			if ( ! site ) {
				return;
			}

			try {
				const updatedSite = {
					...site,
					[ type === 'pull' ? 'lastPullTimestamp' : 'lastPushTimestamp' ]: new Date().toISOString(),
				};

				await getIpcApi().updateSingleConnectedWpcomSite( updatedSite );
				setConnectedSites( ( sites ) =>
					sites.map( ( s ) => ( s.id === site.id ? updatedSite : s ) )
				);
			} catch ( error ) {
				console.error( 'Failed to update timestamp:', error );
			}
		},
		[ connectedSites ]
	);

	const { pullSite, isAnySitePulling, isSiteIdPulling, clearPullState, getPullState } = useSyncPull(
		{
			pullStates,
			setPullStates,
			onPullSuccess: ( remoteSiteId, localSiteId ) =>
				updateSiteTimestamp( remoteSiteId, localSiteId, 'pull' ),
		}
	);

	const [ pushStates, setPushStates ] = useState< PushStates >( {} );
	const { pushSite, isAnySitePushing, isSiteIdPushing, clearPushState, getPushState } = useSyncPush(
		{
			pushStates,
			setPushStates,
			onPushSuccess: ( remoteSiteId, localSiteId ) =>
				updateSiteTimestamp( remoteSiteId, localSiteId, 'push' ),
		}
	);

	const { connectSite, disconnectSite, syncSites, isFetching, refetchSites } =
		useSiteSyncManagement( { connectedSites, setConnectedSites } );

	useListenDeepLinkConnection( { connectSite, refetchSites } );

	return (
		<SyncSitesContext.Provider
			value={ {
				pullSite,
				isAnySitePulling,
				isSiteIdPulling,
				clearPullState,
				connectedSites,
				connectSite,
				disconnectSite,
				syncSites,
				refetchSites,
				isFetching,
				getPullState,
				getPushState,
				pushSite,
				isAnySitePushing,
				isSiteIdPushing,
				clearPushState,
				getLastSyncTimeText,
			} }
		>
			{ children }
		</SyncSitesContext.Provider>
	);
}

export function useSyncSites() {
	const context = useContext( SyncSitesContext );
	if ( context === undefined ) {
		throw new Error( 'useSyncSites must be used within a SyncSitesProvider' );
	}
	return context;
}
