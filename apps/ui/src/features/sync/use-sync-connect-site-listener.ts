import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { classifySyncFailure } from '@studio/common/lib/sync/classify-sync-failure';
import { SYNC_PUSH_SIZE_LIMIT_BYTES } from '@studio/common/lib/sync/constants';
import { useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from 'react';
import { useConnector } from '@/data/core';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import { usePushSiteToLive } from '@/data/queries/use-sync-site';
import { SYNCABLE_WPCOM_SITES_QUERY_KEY } from '@/data/queries/user-scoped-query-keys';
import { websiteIssue } from '@/features/sync/publish-panel/options';
import type { Connector, SyncSite } from '@/data/core';

type ConnectSiteEvent = Parameters< Parameters< Connector[ 'onSyncConnectSite' ] >[ 0 ] >[ 0 ];

// Why the website picked at checkout couldn't be connected, per
// local site, with the event to replay on Try again.
const setupFailures = new Map< string, { error: string; event: ConnectSiteEvent } >();
const listeners = new Set< () => void >();
let receive: ( ( event: ConnectSiteEvent ) => void ) | null = null;

function setSetupFailure( siteId: string, failure?: { error: string; event: ConnectSiteEvent } ) {
	if ( failure ) {
		setupFailures.set( siteId, failure );
	} else if ( ! setupFailures.delete( siteId ) ) {
		return;
	}
	listeners.forEach( ( listener ) => listener() );
}

export function usePublishSetupError( siteId: string ): string | undefined {
	return useSyncExternalStore(
		( listener ) => {
			listeners.add( listener );
			return () => listeners.delete( listener );
		},
		() => setupFailures.get( siteId )?.error
	);
}

export function retryPublishSetup( siteId: string ) {
	const failure = setupFailures.get( siteId );
	setSetupFailure( siteId );
	if ( failure ) {
		receive?.( failure.event );
	}
}

export const clearPublishSetupError = ( siteId: string ) => setSetupFailure( siteId );

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
	// The deep link can arrive more than once for the same checkout.
	const handled = useRef( new Set< string >() );

	const handleConnect = useEffectEvent( async ( event: ConnectSiteEvent ) => {
		const { remoteSiteId, studioSiteId, autoOpenPush } = event;
		const key = `${ studioSiteId }:${ remoteSiteId }`;
		if ( handled.current.has( key ) ) {
			return;
		}
		handled.current.add( key );
		const connectedSites = () =>
			queryClient.getQueryData< SyncSite[] >( connectedWpcomSitesQueryKey( studioSiteId ) ) ?? [];
		let connected = false;
		try {
			const syncable = await queryClient.fetchQuery( {
				queryKey: SYNCABLE_WPCOM_SITES_QUERY_KEY,
				queryFn: () => connector.fetchSyncableWpcomSites(),
				staleTime: 0,
			} );
			const remote = syncable.find( ( site ) => site.id === remoteSiteId );
			if ( ! remote ) {
				throw new Error(
					__( 'Your new website isn’t available yet. Refresh the website list to try again.' )
				);
			}
			const issue = websiteIssue( remote );
			if ( issue ) {
				throw new Error( issue );
			}
			const siteToSave: SyncSite = {
				...remote,
				localSiteId: studioSiteId,
				syncSupport: 'already-connected',
			};
			await connector.connectWpcomSite( studioSiteId, siteToSave );
			connected = true;
			void connector.trackEvent( TRACKS_EVENTS.SYNC_CONNECT, {
				success: true,
				num_of_sites: connectedSites().filter( ( { id } ) => id !== remoteSiteId ).length + 1,
			} );
			// A site created by the Publish flow starts empty, so publish all of it,
			// unless the Publish panel has to warn about it first.
			if ( ! autoOpenPush ) {
				return;
			}
			const [ size, multisite ] = await Promise.all( [
				connector.getDirectorySize( studioSiteId, [ 'wp-content' ] ),
				connector.getIsMultisite( studioSiteId ),
			] );
			if ( ( multisite && ! remote.isPressable ) || size > SYNC_PUSH_SIZE_LIMIT_BYTES ) {
				return;
			}
			pushSite( {
				siteId: studioSiteId,
				remoteSiteId,
				options: { optionsToSync: [ 'all' ] },
				syncSite: remote,
			} );
		} catch ( error ) {
			handled.current.delete( key );
			setSetupFailure( studioSiteId, {
				error: error instanceof Error ? error.message : String( error ),
				event,
			} );
			if ( ! connected ) {
				void connector.trackEvent( TRACKS_EVENTS.SYNC_CONNECT, {
					success: false,
					failure_reason: classifySyncFailure( error, { phase: 'site_fetch' } ),
					num_of_sites: connectedSites().length,
				} );
			}
		} finally {
			void queryClient.invalidateQueries( {
				queryKey: connectedWpcomSitesQueryKey( studioSiteId ),
			} );
		}
	} );

	useEffect( () => {
		receive = ( event ) => void handleConnect( event );
		const unsubscribe = connector.onSyncConnectSite( ( event ) => {
			setSetupFailure( event.studioSiteId );
			receive?.( event );
		} );
		return () => {
			receive = null;
			unsubscribe();
		};
	}, [ connector ] );
}
