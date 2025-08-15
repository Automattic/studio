import { __, sprintf } from '@wordpress/i18n';
import React, { createContext, useCallback, useContext, useState } from 'react';
import { useListenDeepLinkConnection } from 'src/hooks/sync-sites/use-listen-deep-link-connection';
import { PullStates, UseSyncPull, useSyncPull } from 'src/hooks/sync-sites/use-sync-pull';
import { PushStates, UseSyncPush, useSyncPush } from 'src/hooks/sync-sites/use-sync-push';
import { useFormatLocalizedTimestamps } from 'src/hooks/use-format-localized-timestamps';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import {
	useConnectedSitesData,
	useSyncSitesData,
	useConnectedSitesOperations,
	connectedSitesActions,
} from 'src/stores/sync';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';

type GetLastSyncTimeText = ( timestamp: string | null, type: 'pull' | 'push' ) => string;
type UpdateSiteTimestamp = (
	siteId: number | undefined,
	localSiteId: string,
	type: 'pull' | 'push'
) => Promise< void >;

export type SyncSitesContextType = Omit< UseSyncPull, 'pullStates' > &
	Omit< UseSyncPush, 'pushStates' > &
	ReturnType< typeof useSyncSitesData > & {
		getLastSyncTimeText: GetLastSyncTimeText;
	};

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const { formatRelativeTime } = useFormatLocalizedTimestamps();
	const [ pullStates, setPullStates ] = useState< PullStates >( {} );

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

	const { connectedSites } = useConnectedSitesData();
	const { syncSites, isFetching, refetchSites } = useSyncSitesData();
	const { connectSite: connectSiteBase } = useConnectedSitesOperations();
	const dispatch = useAppDispatch();

	const connectSite = useCallback(
		async ( site: SyncSite, overrideLocalSiteId?: string ) => {
			await connectSiteBase( site, overrideLocalSiteId );
		},
		[ connectSiteBase ]
	);

	const updateSiteTimestamp = useCallback< UpdateSiteTimestamp >(
		async ( siteId, localSiteIdParam, type ) => {
			const site = connectedSites.find(
				( { id, localSiteId: siteLocalId } ) => siteId === id && localSiteIdParam === siteLocalId
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

				dispatch(
					connectedSitesActions.updateSite( {
						localSiteId: localSiteIdParam,
						site: updatedSite,
					} )
				);
			} catch ( error ) {
				console.error( 'Failed to update timestamp:', error );
			}
		},
		[ connectedSites, dispatch ]
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

	useListenDeepLinkConnection( { connectSite, refetchSites } );

	return (
		<SyncSitesContext.Provider
			value={ {
				pullSite,
				isAnySitePulling,
				isSiteIdPulling,
				clearPullState,
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
