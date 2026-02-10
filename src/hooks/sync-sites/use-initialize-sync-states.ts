import { useEffect } from 'react';
import { mapImportResponseToPushState } from 'src/hooks/sync-sites/use-sync-push';
import { useAuth } from 'src/hooks/use-auth';
import { useSyncStatesProgressInfo } from 'src/hooks/use-sync-states-progress-info';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import { syncOperationsActions } from 'src/stores/sync';
import type { ImportResponse } from 'src/hooks/use-sync-states-progress-info';

/**
 * Hook to initialize push states from in-progress server operations on mount.
 * This restores push state for any operations that were in progress when the app was closed.
 */
export function useInitializeSyncStates() {
	const { client } = useAuth();
	const { pushStatesProgressInfo } = useSyncStatesProgressInfo();
	const dispatch = useAppDispatch();

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
									status,
									selectedSite: localSite,
									remoteSiteUrl: connectedSite.url,
								},
							} )
						);
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
}
