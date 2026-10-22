import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { classifySyncFailure } from '@studio/common/lib/sync/classify-sync-failure';
import {
	SYNC_PUSH_SIZE_LIMIT_BYTES,
	SYNC_PUSH_SIZE_LIMIT_GB,
} from '@studio/common/lib/sync/constants';
import { useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useEffectEvent } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { usePushSiteToLive } from '@/data/queries/use-sync-site';
import { SYNCABLE_WPCOM_SITES_QUERY_KEY } from '@/data/queries/use-wpcom-sites';
import type { SyncSite } from '@/data/core';

// Bridges the `wp-studio://sync-connect-site` deep link into apps/ui. The
// main-process routes the URL through `handleSyncConnectSiteDeeplink`, which
// fires a `sync-connect-site` IPC event carrying the freshly picked remote
// site id and the local Studio site id the connection belongs to. This hook
// persists the connection and refreshes the cache so the Publish panel updates
// without requiring a full app reload.
export function useSyncConnectSiteListener(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { mutate: pushSite } = usePushSiteToLive();

	const publishEverything = useEffectEvent( async ( siteId: string, remote: SyncSite ) => {
		const [ size, multisite ] = await Promise.all( [
			connector.getDirectorySize( siteId, [ 'wp-content' ] ),
			connector.getIsMultisite( siteId ),
		] );
		if ( multisite && ! remote.isPressable ) {
			toast.error( __( 'Publishing didn’t finish' ), {
				description: __(
					'WordPress.com does not support publishing a WordPress Multisite network.'
				),
			} );
		} else if ( size > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
			toast.error( __( 'Publishing didn’t finish' ), {
				description: sprintf(
					/* translators: %s: the publishing size limit in GB */
					__( 'This site exceeds the %s GB publishing limit. Choose fewer files to publish.' ),
					String( SYNC_PUSH_SIZE_LIMIT_GB )
				),
			} );
		} else {
			pushSite( {
				siteId,
				remoteSiteId: remote.id,
				options: { optionsToSync: [ 'all' ] },
				syncSite: remote,
			} );
		}
	} );

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
				// A site created by the Publish flow starts empty, so publish all of it.
				if ( autoOpenPush ) {
					void publishEverything( studioSiteId, siteToSave );
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
