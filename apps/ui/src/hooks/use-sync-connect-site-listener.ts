import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { classifySyncFailure } from '@studio/common/lib/sync/classify-sync-failure';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import type { SyncSite } from '@/data/core';

// Bridges the `wp-studio://sync-connect-site` deep link into apps/ui. The
// main-process routes the URL through `handleSyncConnectSiteDeeplink`, which
// fires a `sync-connect-site` IPC event carrying the freshly picked remote
// site id and the local Studio site id the connection belongs to. This hook
// persists the connection and refreshes the cache so the dropdown updates
// without requiring a full app reload.
//
// A connection made by the Publish flow (`autoOpenPush`) also asks the site's
// dropdown to open the push dialog, since the new WordPress.com site is empty.
export function useSyncConnectSiteListener(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();

	useEffect( () => {
		return connector.onSyncConnectSite( async ( { remoteSiteId, studioSiteId, autoOpenPush } ) => {
			try {
				// Fetch the full site record first so we persist the real
				// display name / URL in one write. `connectWpcomSites` skips
				// duplicate (id, localSiteId) tuples, so a second call
				// wouldn't overwrite a placeholder saved beforehand.
				const syncable = await connector.fetchSyncableWpcomSites();
				const fullSite = syncable.find( ( site ) => site.id === remoteSiteId );
				const siteToSave: SyncSite = fullSite
					? {
							...fullSite,
							localSiteId: studioSiteId,
							syncSupport: 'already-connected',
					  }
					: {
							id: remoteSiteId,
							localSiteId: studioSiteId,
							name: '',
							url: '',
							isStaging: false,
							isPressable: false,
							environmentType: null,
							syncSupport: 'already-connected',
							lastPullTimestamp: null,
							lastPushTimestamp: null,
					  };
				await connector.connectWpcomSite( studioSiteId, siteToSave );
				if ( autoOpenPush ) {
					pendingPush = { siteId: studioSiteId, remoteSiteId };
					pendingPushListeners.forEach( ( listener ) => listener() );
				}
				const connected =
					queryClient.getQueryData< SyncSite[] >( connectedWpcomSitesQueryKey( studioSiteId ) ) ??
					[];
				void connector.trackEvent( TRACKS_EVENTS.SYNC_CONNECT, {
					success: true,
					num_of_sites: connected.filter( ( { id } ) => id !== remoteSiteId ).length + 1,
				} );
			} catch ( error ) {
				void connector.trackEvent( TRACKS_EVENTS.SYNC_CONNECT, {
					success: false,
					// The site lookup and the storage write are both in this try.
					failure_reason: classifySyncFailure( error, { phase: 'site_fetch' } ),
					num_of_sites:
						queryClient.getQueryData< SyncSite[] >( connectedWpcomSitesQueryKey( studioSiteId ) )
							?.length ?? 0,
				} );
				console.error( 'Failed to persist deep-link connection:', error );
			} finally {
				void queryClient.invalidateQueries( {
					queryKey: connectedWpcomSitesQueryKey( studioSiteId ),
				} );
			}
		} );
	}, [ connector, queryClient ] );
}

let pendingPush: { siteId: string; remoteSiteId: number } | null = null;
const pendingPushListeners = new Set< () => void >();

function subscribePendingPush( listener: () => void ) {
	pendingPushListeners.add( listener );
	return () => {
		pendingPushListeners.delete( listener );
	};
}

// The live site the Publish flow wants pushed to from this local site, if any.
export function usePendingPush( siteId: string ): number | null {
	return useSyncExternalStore( subscribePendingPush, () =>
		pendingPush?.siteId === siteId ? pendingPush.remoteSiteId : null
	);
}

// Claims the pending push, so only one of the site's dropdowns opens it.
export function consumePendingPush( siteId: string ): boolean {
	if ( pendingPush?.siteId !== siteId ) {
		return false;
	}
	pendingPush = null;
	pendingPushListeners.forEach( ( listener ) => listener() );
	return true;
}
