import { __, sprintf } from '@wordpress/i18n';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useListenDeepLinkConnection } from 'src/hooks/sync-sites/use-listen-deep-link-connection';
import { generateStateId } from 'src/hooks/sync-sites/use-pull-push-states';
import { PullStates, UseSyncPull, useSyncPull } from 'src/hooks/sync-sites/use-sync-pull';
import {
	PushStates,
	UseSyncPush,
	useSyncPush,
	mapImportResponseToPushState,
} from 'src/hooks/sync-sites/use-sync-push';
import { useAuth } from 'src/hooks/use-auth';
import { useFormatLocalizedTimestamps } from 'src/hooks/use-format-localized-timestamps';
import { useSyncStatesProgressInfo } from 'src/hooks/use-sync-states-progress-info';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import { useConnectedSitesData, useSyncSitesData, connectedSitesActions } from 'src/stores/sync';
import type { ImportResponse } from 'src/hooks/use-sync-states-progress-info';

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
	const dispatch = useAppDispatch();

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

	const { pullSite, isAnySitePulling, isSiteIdPulling, clearPullState, getPullState, cancelPull } =
		useSyncPull( {
			pullStates,
			setPullStates,
			onPullSuccess: ( remoteSiteId, localSiteId ) =>
				updateSiteTimestamp( remoteSiteId, localSiteId, 'pull' ),
		} );

	const [ pushStates, setPushStates ] = useState< PushStates >( {} );
	const { pushSite, isAnySitePushing, isSiteIdPushing, clearPushState, getPushState, cancelPush } =
		useSyncPush( {
			pushStates,
			setPushStates,
			onPushSuccess: ( remoteSiteId, localSiteId ) =>
				updateSiteTimestamp( remoteSiteId, localSiteId, 'push' ),
		} );

	const { syncSites, isFetching, refetchSites } = useSyncSitesData();
	useListenDeepLinkConnection( { refetchSites } );

	const { client } = useAuth();
	const { pushStatesProgressInfo } = useSyncStatesProgressInfo();

	// Initialize push states from in-progress server operations on mount
	useEffect( () => {
		if ( ! client ) {
			return;
		}

		const initializePushStates = async () => {
			const allSites = await getIpcApi().getSiteDetails();
			const allConnectedSites = await getIpcApi().getConnectedWpcomSites();

			const restoredStates: PushStates = {};

			for ( const connectedSite of allConnectedSites ) {
				try {
					const localSite = allSites.find( ( site ) => site.id === connectedSite.localSiteId );

					if ( ! localSite ) {
						continue;
					}

					const response = await client.req.get< ImportResponse >(
						`/sites/${ connectedSite.id }/studio-app/sync/import`,
						{
							apiNamespace: 'wpcom/v2',
						}
					);

					const status = mapImportResponseToPushState( response, pushStatesProgressInfo );

					// Only restore the pushStates if the operation is still in progress
					if ( status ) {
						const stateId = generateStateId( connectedSite.localSiteId, connectedSite.id );
						restoredStates[ stateId ] = {
							remoteSiteId: connectedSite.id,
							status,
							selectedSite: localSite,
							remoteSiteUrl: connectedSite.url,
						};

						getIpcApi().addSyncOperation( stateId, status );
					}
				} catch ( error ) {
					// Continue checking other sites even if one fails
					console.error( `Failed to check push progress for site ${ connectedSite.id }:`, error );
				}
			}

			if ( Object.keys( restoredStates ).length > 0 ) {
				setPushStates( ( prev ) => ( { ...prev, ...restoredStates } ) );
			}
		};

		initializePushStates().catch( ( error ) => {
			// Initialization is not critical to app functionality, but log the error
			console.error( 'Failed to initialize push states from server:', error );
		} );
	}, [ client, pushStatesProgressInfo ] );

	return (
		<SyncSitesContext.Provider
			value={ {
				pullSite,
				isAnySitePulling,
				isSiteIdPulling,
				clearPullState,
				cancelPull,
				syncSites,
				refetchSites,
				isFetching,
				getPullState,
				getPushState,
				pushSite,
				isAnySitePushing,
				isSiteIdPushing,
				clearPushState,
				cancelPush,
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
