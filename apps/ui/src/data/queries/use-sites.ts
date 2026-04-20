import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import type { CreateSiteParams, SiteDetails } from '@/data/core';

export const SITES_QUERY_KEY = [ 'sites' ] as const;

const START_SITE_MUTATION_KEY = [ 'startSite' ] as const;
const STOP_SITE_MUTATION_KEY = [ 'stopSite' ] as const;

export function useSites() {
	const connector = useConnector();
	return useQuery( {
		queryKey: SITES_QUERY_KEY,
		queryFn: () => connector.getSites(),
	} );
}

export function useCreateSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( params: CreateSiteParams ) => connector.createSite( params ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
	} );
}

export function useDeleteSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( id: string ) => connector.deleteSite( id ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
	} );
}

// Invalidation is awaited inside `mutationFn` (not `onSettled`) so
// `isPending` stays true until `site.running` reflects the new state.
export function useStartSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: START_SITE_MUTATION_KEY,
		mutationFn: async ( id: string ) => {
			await connector.startSite( id );
			await queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
		},
	} );
}

export function useStopSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: STOP_SITE_MUTATION_KEY,
		mutationFn: async ( id: string ) => {
			await connector.stopSite( id );
			await queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
		},
	} );
}

export interface UpdateSiteInput {
	site: SiteDetails;
	// Provided only when the user switched WP version; undefined means the
	// site stays on its current auto-updating track.
	wpVersion?: string;
}

export function useUpdateSite() {
	const connector = useConnector();
	return useMutation( {
		mutationFn: async ( { site, wpVersion }: UpdateSiteInput ) => {
			await connector.updateSite( site, wpVersion );
			// Intentionally skip an immediate invalidateQueries here: the CLI
			// edit and the site-updated event are emitted from two separate
			// CLI processes, so the event is usually still in flight when the
			// IPC call resolves. A refetch fired now races ahead of the
			// handler in cli-events-subscriber and returns pre-event state,
			// which flashes the old values back into the settings form.
			// `useSyncSitesWithEvents` invalidates `SITES_QUERY_KEY` once the
			// site-event lands, giving us a single refetch against fresh
			// in-memory details.
		},
	} );
}

const XDEBUG_ENABLED_SITE_QUERY_KEY = [ 'xdebugEnabledSite' ] as const;

export function useXdebugEnabledSite() {
	const connector = useConnector();
	return useQuery( {
		queryKey: XDEBUG_ENABLED_SITE_QUERY_KEY,
		queryFn: () => connector.getXdebugEnabledSite(),
	} );
}

function useIsSiteMutating( siteId: string | undefined, mutationKey: readonly string[] ): boolean {
	const count = useIsMutating( {
		mutationKey,
		predicate: ( mutation ) => mutation.state.variables === siteId,
	} );
	return count > 0;
}

export function useIsSiteStarting( siteId: string | undefined ): boolean {
	return useIsSiteMutating( siteId, START_SITE_MUTATION_KEY );
}

export function useIsSiteStopping( siteId: string | undefined ): boolean {
	return useIsSiteMutating( siteId, STOP_SITE_MUTATION_KEY );
}

/**
 * Keeps the cached site list in sync with main-process events (site created,
 * updated, started, stopped, deleted). Mount once near the app root.
 */
export function useSyncSitesWithEvents(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();
	useEffect( () => {
		return connector.onSiteEvent( () => {
			void queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
		} );
	}, [ connector, queryClient ] );
}
