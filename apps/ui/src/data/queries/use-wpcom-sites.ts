import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { connectedWpcomSitesQueryKey } from '@/data/queries/use-connected-wpcom-sites';
import type { SyncSite } from '@/data/core';

export const SYNCABLE_WPCOM_SITES_QUERY_KEY = [ 'syncable-wpcom-sites' ] as const;
export const ALL_CONNECTED_WPCOM_SITES_QUERY_KEY = [ 'all-connected-wpcom-sites' ] as const;
const CONNECTED_WPCOM_SITES_PREFIX = connectedWpcomSitesQueryKey( '' ).slice( 0, 1 );

export function useSyncableWpcomSites( options: { enabled?: boolean } = {} ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { data: authUser } = useAuthUser();
	return useQuery( {
		queryKey: SYNCABLE_WPCOM_SITES_QUERY_KEY,
		queryFn: async () => {
			const sites = await connector.fetchSyncableWpcomSites();
			// The fetch also refreshed the stored connections.
			void queryClient.invalidateQueries( { queryKey: CONNECTED_WPCOM_SITES_PREFIX } );
			void queryClient.invalidateQueries( { queryKey: ALL_CONNECTED_WPCOM_SITES_QUERY_KEY } );
			return sites;
		},
		enabled: ( options.enabled ?? true ) && !! authUser,
		// This query hits the network and the data doesn't change often.
		// Keep it fresh for a few minutes so opening/closing the picker
		// repeatedly doesn't spam WordPress.com.
		staleTime: 5 * 60 * 1000,
	} );
}

// Mirrors `useConnectedWpcomSites` but returns connections for every local
// site — used to filter out WordPress.com sites that are already attached to
// another Studio site when picking a publish target.
function useAllConnectedWpcomSites( options: { enabled?: boolean } = {} ) {
	const connector = useConnector();
	const { data: authUser } = useAuthUser();
	return useQuery( {
		queryKey: ALL_CONNECTED_WPCOM_SITES_QUERY_KEY,
		queryFn: () => connector.getConnectedWpcomSites(),
		enabled: ( options.enabled ?? true ) && !! authUser,
	} );
}

export function usePickableWpcomSites( options: { enabled?: boolean } = {} ) {
	const syncable = useSyncableWpcomSites( options );
	const connected = useAllConnectedWpcomSites( options );

	const data = useMemo< SyncSite[] | undefined >( () => {
		if ( ! syncable.data ) {
			return undefined;
		}
		const connectedIds = new Set( ( connected.data ?? [] ).map( ( site ) => site.id ) );
		return syncable.data.filter(
			( site ) => ! connectedIds.has( site.id ) && site.syncSupport === 'syncable'
		);
	}, [ syncable.data, connected.data ] );

	return {
		data,
		isLoading: syncable.isLoading || connected.isLoading,
		isFetching: syncable.isFetching || connected.isFetching,
		error: syncable.error ?? connected.error,
		refetch: () => {
			void syncable.refetch();
			void connected.refetch();
		},
	};
}
