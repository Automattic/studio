import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { classifySyncFailure } from '@studio/common/lib/sync/classify-sync-failure';
import { useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect } from 'react';
import { stripProtocol } from '@/components/site-dropdown/utils';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { SYNCABLE_WPCOM_SITES_QUERY_KEY } from '@/data/queries/use-wpcom-sites';
import type { SyncSite } from '@/data/core';

// Bridges the `wp-studio://sync-connect-site` deep link into apps/ui. The
// main-process routes the URL through `handleSyncConnectSiteDeeplink`, which
// fires a `sync-connect-site` IPC event carrying the freshly picked remote
// site id and the local Studio site id the connection belongs to. This hook
// persists the connection and refreshes the cache so the dropdown updates
// without requiring a full app reload.
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
				const syncable = await queryClient.fetchQuery( {
					queryKey: SYNCABLE_WPCOM_SITES_QUERY_KEY,
					queryFn: () => connector.fetchSyncableWpcomSites(),
				} );
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
				// A site created by the Publish flow starts empty: say what's left to do.
				if ( autoOpenPush ) {
					toast.success(
						siteToSave.url
							? sprintf(
									/* translators: %s: address of the newly connected WordPress.com site */
									__( '%s is connected' ),
									stripProtocol( siteToSave.url )
							  )
							: __( 'Your new WordPress.com site is connected' ),
						{ description: __( 'Push your site to publish it.' ) }
					);
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
