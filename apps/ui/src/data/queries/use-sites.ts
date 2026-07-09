import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
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

export interface DeleteSiteInput {
	id: string;
	// Defaults to true so the delete confirmation can omit the flag and the
	// caller still removes the site folder from disk.
	deleteFiles?: boolean;
}

export function useDeleteSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { id, deleteFiles = true }: DeleteSiteInput ) =>
			connector.deleteSite( id, deleteFiles ),
		// Deleting a site also deletes its chat sessions (CLI `site delete`),
		// so refresh the session list alongside the site list.
		onSuccess: () =>
			Promise.all( [
				queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
				queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } ),
			] ),
	} );
}

export function useCopySite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( sourceSiteId: string ) => connector.copySite( sourceSiteId ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
	} );
}

export function useExportFullSite() {
	const connector = useConnector();
	return useMutation( {
		mutationFn: ( siteId: string ) => connector.exportFullSite( siteId ),
	} );
}

export function useExportDatabase() {
	const connector = useConnector();
	return useMutation( {
		mutationFn: ( siteId: string ) => connector.exportDatabase( siteId ),
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

/**
 * The site that currently has Xdebug enabled — exclusive across sites — derived
 * from the loaded site list so the settings form can warn before enabling it
 * elsewhere. `enableXdebug` is already on every SiteDetails, so no separate call.
 */
export function useXdebugEnabledSite(): SiteDetails | null {
	const { data: sites } = useSites();
	return useMemo( () => sites?.find( ( site ) => site.enableXdebug ) ?? null, [ sites ] );
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
		return connector.onSiteEvent( ( event ) => {
			void queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
			// Site deletion deletes the site's chat sessions (CLI `site
			// delete`), so refresh the session list too. Scoped to deletes:
			// start/stop events fire often and don't affect sessions.
			if ( event.event === SITE_EVENTS.DELETED ) {
				void queryClient.invalidateQueries( { queryKey: SESSIONS_QUERY_KEY } );
			}
		} );
	}, [ connector, queryClient ] );
}
