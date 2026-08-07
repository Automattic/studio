import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { conflictsWith, getBlockingOperation } from '@studio/common/lib/site-operation';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useEffect, useMemo, useRef } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { WP_VERSION_QUERY_KEY } from '@/data/queries/use-wordpress-versions';
import type { CreateSiteParams, SiteDetails } from '@/data/core';
import type { SiteOperationKind } from '@studio/common/lib/site-operation';
import type { QueryClient } from '@tanstack/react-query';

export const SITES_QUERY_KEY = [ 'sites' ] as const;

// The index route's redirect `beforeLoad` fetches the site and session lists to
// choose a destination. Refreshing those lists after a delete with the default
// `cancelRefetch: true` cancels that in-flight fetch, surfacing a `CancelledError`
// in the router's error boundary (a red error flashes and recovers). Keeping the
// in-flight fetch alive lets it settle with the fresh post-delete data instead.
const KEEP_INFLIGHT_FETCH = { cancelRefetch: false } as const;

const START_SITE_MUTATION_KEY = [ 'startSite' ] as const;
const STOP_SITE_MUTATION_KEY = [ 'stopSite' ] as const;
const COPY_SITE_MUTATION_KEY = [ 'copySite' ] as const;

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
		// Deleting a site also deletes its chat sessions (CLI `site delete`), so
		// refresh the session list alongside the site list. `exact` keeps this
		// off the open session's own detail query, which would refetch into a
		// 404 for the just-deleted session.
		onSuccess: () =>
			Promise.all( [
				queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY }, KEEP_INFLIGHT_FETCH ),
				queryClient.invalidateQueries(
					{ queryKey: SESSIONS_QUERY_KEY, exact: true },
					KEEP_INFLIGHT_FETCH
				),
			] ),
	} );
}

export function useCopySite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		// Keyed so `useSiteOperation` can spot an in-flight copy. Duplication is
		// the one operation with no CLI lease behind it — see `SITE_OPERATIONS`.
		mutationKey: COPY_SITE_MUTATION_KEY,
		mutationFn: ( sourceSiteId: string ) => connector.copySite( sourceSiteId ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
		onError: () => toast.error( __( 'Failed to copy site' ) ),
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
		// Returns false when the start was skipped, so the caller's toast (and
		// anything else keyed off success) doesn't claim a site came up.
		mutationFn: async ( id: string ): Promise< boolean > => {
			// Don't call the CLI when it would only refuse. Buttons are already
			// disabled via `useIsSiteBusy`, but auto-start and "open a URL in the
			// preview" fire programmatically with no control to disable, and a
			// start racing an in-flight stop used to loop forever.
			if ( isStartBlocked( queryClient, id ) ) {
				return false;
			}
			await connector.startSite( id );
			await queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
			return true;
		},
		onSuccess: ( started ) => {
			if ( started ) {
				toast.success( __( 'Site started' ) );
			}
		},
		onError: () => toast.error( __( 'Failed to start site' ) ),
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
		onSuccess: () => toast.success( __( 'Site stopped' ) ),
		onError: () => toast.error( __( 'Failed to stop site' ) ),
	} );
}

export interface UpdateSiteInput {
	site: SiteDetails;
	// Provided only when the user switched WP version; undefined means the
	// site stays on its current auto-updating track.
	wpVersion?: string;
}

// Spaced values (1000, 2000, …) match the legacy desktop sidebar's
// convention for the same appdata field.
const toSortOrderUpdates = ( orderedSiteIds: string[] ) =>
	orderedSiteIds.map( ( siteId, index ) => ( { siteId, sortOrder: ( index + 1 ) * 1000 } ) );

// Persists the sidebar's manual site order. The new order is patched into the
// sites cache optimistically, so the UI — and the persisted query snapshot a
// reload hydrates from — reorders immediately; on error a refetch restores
// the stored truth.
export function useUpdateSitesSortOrder() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( orderedSiteIds: string[] ) =>
			connector.updateSitesSortOrder( toSortOrderUpdates( orderedSiteIds ) ),
		onMutate: ( orderedSiteIds ) => {
			const rank = new Map(
				toSortOrderUpdates( orderedSiteIds ).map( ( { siteId, sortOrder } ) => [
					siteId,
					sortOrder,
				] )
			);
			queryClient.setQueryData< SiteDetails[] >(
				SITES_QUERY_KEY,
				( sites ) =>
					sites?.map( ( site ) => {
						const sortOrder = rank.get( site.id );
						return sortOrder === undefined ? site : { ...site, sortOrder };
					} )
			);
		},
		onError: () => queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
	} );
}

export function useUpdateSite() {
	const connector = useConnector();
	const queryClient = useQueryClient();
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
		onSuccess: ( _data, { site, wpVersion } ) => {
			// Seed the applied version rather than refetching it: the CLI keeps
			// restarting the site after this resolves, and a disk read landing
			// mid-restart still reports the pre-edit version, which would flash
			// the old value back into the settings form.
			if ( wpVersion ) {
				queryClient.setQueryData( [ ...WP_VERSION_QUERY_KEY, site.id ], wpVersion );
			}
			toast.success( __( 'Settings saved' ) );
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

// Imperative twin of `useIsSiteMutating`, for reading the same state from
// inside a `mutationFn` where hooks aren't available.
function isSiteMutating(
	queryClient: QueryClient,
	mutationKey: readonly string[],
	siteId: string
): boolean {
	return (
		queryClient.isMutating( {
			mutationKey,
			predicate: ( mutation ) => mutation.state.variables === siteId,
		} ) > 0
	);
}

// Would the CLI refuse this start? Checks its lease on the cached site record
// (which covers work the agent or another window started) plus this client's
// own in-flight stop, which lands before the CLI has written anything.
function isStartBlocked( queryClient: QueryClient, siteId: string ): boolean {
	if ( isSiteMutating( queryClient, STOP_SITE_MUTATION_KEY, siteId ) ) {
		return true;
	}
	const sites = queryClient.getQueryData< SiteDetails[] >( SITES_QUERY_KEY );
	const operations = sites?.find( ( site ) => site.id === siteId )?.operations;
	return Boolean( operations?.some( ( operation ) => conflictsWith( operation.kind, 'start' ) ) );
}

export function useIsSiteStarting( siteId: string | undefined ): boolean {
	return useIsSiteMutating( siteId, START_SITE_MUTATION_KEY );
}

export function useIsSiteStopping( siteId: string | undefined ): boolean {
	return useIsSiteMutating( siteId, STOP_SITE_MUTATION_KEY );
}

/**
 * The operation currently holding the site, or null. Mostly the CLI's lease on
 * the site record, so it covers work the agent or another Studio window
 * started — not just this client's own mutations. Exclusive operations win,
 * since they're the ones that block everything.
 *
 * Duplication is the exception: no CLI command performs it, so it's read from
 * the in-flight mutation. That only sees this window, which is enough because
 * a duplicate can't originate anywhere else.
 */
export function useSiteOperation( site: SiteDetails | undefined ): SiteOperationKind | null {
	const isDuplicating = useIsSiteMutating( site?.id, COPY_SITE_MUTATION_KEY );
	return getBlockingOperation( site?.operations ) ?? ( isDuplicating ? 'duplicate' : null );
}

/**
 * Whether the site is mid-transition and its actions should be disabled. Folds
 * this client's in-flight start/stop — which lands before the CLI writes its
 * lease — into the CLI's authoritative view.
 */
export function useIsSiteBusy( site: SiteDetails | undefined ): boolean {
	const isStarting = useIsSiteStarting( site?.id );
	const isStopping = useIsSiteStopping( site?.id );
	const operation = useSiteOperation( site );
	return isStarting || isStopping || operation !== null;
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
			void queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY }, KEEP_INFLIGHT_FETCH );
			// Site deletion deletes the site's chat sessions (CLI `site delete`),
			// so refresh the session list too. Scoped to deletes: start/stop
			// events fire often and don't affect sessions. `exact` keeps this off
			// the open session's own detail query.
			if ( event.event === SITE_EVENTS.DELETED ) {
				void queryClient.invalidateQueries(
					{ queryKey: SESSIONS_QUERY_KEY, exact: true },
					KEEP_INFLIGHT_FETCH
				);
			}
		} );
	}, [ connector, queryClient ] );
}

// Boot-time counterpart of the "Stop, restart on next launch" quit behavior:
// those sites keep their autoStart flag when stopped on quit, and the renderer
// starts them again on launch (mirrors the legacy UI's use-site-details
// bootstrapping). Gated on isFetchedAfterMount so a rehydrated persisted cache
// with stale flags can't trigger starts.
export function useAutoStartSites(): void {
	const { data: sites, isFetchedAfterMount } = useSites();
	const { mutate: startSite } = useStartSite();
	const startedRef = useRef( false );
	useEffect( () => {
		if ( ! isFetchedAfterMount || ! sites || startedRef.current ) {
			return;
		}
		startedRef.current = true;
		for ( const site of sites ) {
			if ( site.autoStart && ! site.running ) {
				startSite( site.id );
			}
		}
	}, [ isFetchedAfterMount, sites, startSite ] );
}
