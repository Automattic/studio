import { __, sprintf } from '@wordpress/i18n';
import React, { createContext, useCallback, useContext, useEffect } from 'react';
import { useListenDeepLinkConnection } from 'src/hooks/sync-sites/use-listen-deep-link-connection';
import { generateStateId } from 'src/hooks/sync-sites/use-pull-push-states';
import { UseSyncPull, useSyncPull } from 'src/hooks/sync-sites/use-sync-pull';
import {
	UseSyncPush,
	useSyncPush,
	mapImportResponseToPushState,
} from 'src/hooks/sync-sites/use-sync-push';
import { useAuth } from 'src/hooks/use-auth';
import { useFormatLocalizedTimestamps } from 'src/hooks/use-format-localized-timestamps';
import { useSyncStatesProgressInfo } from 'src/hooks/use-sync-states-progress-info';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import { syncOperationsActions } from 'src/stores/sync';
import { useUpdateSiteTimestampMutation } from 'src/stores/sync/connected-sites';
import type { ImportResponse } from 'src/hooks/use-sync-states-progress-info';

type GetLastSyncTimeText = ( timestamp: string | null, type: 'pull' | 'push' ) => string;

export type SyncSitesContextType = Omit< UseSyncPull, 'pullStates' > &
	Omit< UseSyncPush, 'pushStates' > & {
		getLastSyncTimeText: GetLastSyncTimeText;
	};

const SyncSitesContext = createContext< SyncSitesContextType | undefined >( undefined );

export function SyncSitesProvider( { children }: { children: React.ReactNode } ) {
	const { formatRelativeTime } = useFormatLocalizedTimestamps();

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

	const dispatch = useAppDispatch();
	const [ updateSiteTimestamp ] = useUpdateSiteTimestampMutation();

	const { pullSite, isAnySitePulling, isSiteIdPulling, clearPullState, getPullState, cancelPull } =
		useSyncPull( {
			onPullSuccess: ( remoteSiteId, localSiteId ) =>
				updateSiteTimestamp( { siteId: remoteSiteId, localSiteId, type: 'pull' } ),
		} );

	const { pushSite, isAnySitePushing, isSiteIdPushing, clearPushState, getPushState, cancelPush } =
		useSyncPush( {
			onPushSuccess: ( remoteSiteId, localSiteId ) =>
				updateSiteTimestamp( { siteId: remoteSiteId, localSiteId, type: 'push' } ),
		} );

	useListenDeepLinkConnection();

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

			for ( const connectedSite of allConnectedSites ) {
				try {
					const localSite = allSites.find( ( site ) => site.id === connectedSite.localSiteId );
					const hasConnectionErrors = connectedSite?.syncSupport !== 'already-connected';

					if ( ! localSite || hasConnectionErrors ) {
						continue;
					}

					const response = ( await client.req.get(
						`/sites/${ connectedSite.id }/studio-app/sync/import`,
						{
							apiNamespace: 'wpcom/v2',
						}
					) ) as ImportResponse;

					const status = mapImportResponseToPushState( response, pushStatesProgressInfo );

					// Only restore the pushStates if the operation is still in progress
					if ( status ) {
						dispatch(
							syncOperationsActions.updatePushState( {
								selectedSiteId: connectedSite.localSiteId,
								remoteSiteId: connectedSite.id,
								state: {
									remoteSiteId: connectedSite.id,
									status,
									selectedSite: localSite,
									remoteSiteUrl: connectedSite.url,
								},
							} )
						);

						const stateId = generateStateId( connectedSite.localSiteId, connectedSite.id );
						getIpcApi().addSyncOperation( stateId, status );
					}
				} catch ( error ) {
					// Continue checking other sites even if one fails
					console.error( `Failed to check push progress for site ${ connectedSite.id }:`, error );
				}
			}
		};

		initializePushStates().catch( ( error ) => {
			// Initialization is not critical to app functionality, but log the error
			console.error( 'Failed to initialize push states from server:', error );
		} );
	}, [ client, pushStatesProgressInfo, dispatch ] );

	return (
		<SyncSitesContext.Provider
			value={ {
				pullSite,
				isAnySitePulling,
				isSiteIdPulling,
				clearPullState,
				cancelPull,
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
