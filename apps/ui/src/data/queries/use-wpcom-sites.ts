import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useConnector } from '@/data/core';
import type { SyncSite } from '@/data/core';

const SYNCABLE_WPCOM_SITES_QUERY_KEY = [ 'syncable-wpcom-sites' ] as const;
const ALL_CONNECTED_WPCOM_SITES_QUERY_KEY = [ 'all-connected-wpcom-sites' ] as const;

export function useSyncableWpcomSites( options: { enabled?: boolean } = {} ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: SYNCABLE_WPCOM_SITES_QUERY_KEY,
		queryFn: () => connector.fetchSyncableWpcomSites(),
		enabled: options.enabled ?? true,
		// This query hits the network and the data doesn't change often.
		// Keep it fresh for a few minutes so opening/closing the picker
		// repeatedly doesn't spam WordPress.com.
		staleTime: 5 * 60 * 1000,
	} );
}

export function useSyncableWpcomSitesPage(
	options: { enabled?: boolean; page?: number; perPage?: number; search?: string } = {}
) {
	const connector = useConnector();
	const search = options.search?.trim() ?? '';
	const page = options.page ?? 1;
	const perPage = options.perPage ?? 100;
	return useQuery( {
		queryKey: [ ...SYNCABLE_WPCOM_SITES_QUERY_KEY, 'page', page, perPage, search ],
		queryFn: () =>
			connector.fetchSyncableWpcomSitesPage( {
				page,
				perPage,
				search: search || undefined,
			} ),
		enabled: options.enabled ?? true,
		placeholderData: ( previousData ) => previousData,
		staleTime: 5 * 60 * 1000,
	} );
}

// Mirrors `useConnectedWpcomSites` but returns connections for every local
// site — used to filter out WordPress.com sites that are already attached to
// another Studio site when picking a publish target.
export function useAllConnectedWpcomSites( options: { enabled?: boolean } = {} ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: ALL_CONNECTED_WPCOM_SITES_QUERY_KEY,
		// The IPC signature requires a localSiteId; an empty string is treated
		// as "no filter" so we get every connection on record. See the
		// `getConnectedWpcomSites` main-process handler.
		queryFn: () => connector.getConnectedWpcomSites( '' ),
		enabled: options.enabled ?? true,
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
