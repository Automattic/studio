import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { getSiteOperationNoun } from '@studio/common/lib/site-operation-labels';
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
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
// Keyed so progress survives navigation: a `useMutation` observer dies with the
// component that created it, so a remounted screen would report "idle" while
// the work is still running. Counting the mutation cache instead is the same
// trick `useIsSiteStarting` uses.
export const COPY_SITE_MUTATION_KEY = [ 'copySite' ] as const;
export const EXPORT_FULL_SITE_MUTATION_KEY = [ 'exportFullSite' ] as const;
export const EXPORT_DATABASE_MUTATION_KEY = [ 'exportDatabase' ] as const;

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
		// the one kind no CLI command records — see `SITE_OPERATIONS`.
		mutationKey: COPY_SITE_MUTATION_KEY,
		mutationFn: ( sourceSiteId: string ) => connector.copySite( sourceSiteId ),
		onSuccess: () => queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } ),
		onError: () => toast.error( __( 'Failed to copy site' ) ),
	} );
}

export function useExportFullSite() {
	const connector = useConnector();
	return useMutation( {
		mutationKey: EXPORT_FULL_SITE_MUTATION_KEY,
		mutationFn: ( siteId: string ) => connector.exportFullSite( siteId ),
	} );
}

export function useExportDatabase() {
	const connector = useConnector();
	return useMutation( {
		mutationKey: EXPORT_DATABASE_MUTATION_KEY,
		mutationFn: ( siteId: string ) => connector.exportDatabase( siteId ),
	} );
}

export interface StartSiteOptions {
	// Set by callers whose start is a side effect of something else — boot
	// auto-start, the connect-site lifecycle, opening a link on a stopped site.
	// The site's own status already reports the start, and a batch of them
	// would otherwise fill the shelf with notifications nobody asked for.
	// Failures still surface: a site that never came up is worth a toast.
	silent?: boolean;
}

// Invalidation is awaited inside `mutationFn` (not `onSettled`) so
// `isPending` stays true until `site.running` reflects the new state.
export function useStartSite( { silent = false }: StartSiteOptions = {} ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationKey: START_SITE_MUTATION_KEY,
		// Returns false when the start was skipped, so the caller's toast (and
		// anything else keyed off success) doesn't claim a site came up.
		mutationFn: async ( id: string ): Promise< boolean > => {
			// A stop this window fired moments ago hasn't been recorded by the CLI
			// yet, and racing it used to loop forever. Deliberately the only
			// pre-flight: everything else is the CLI's call, so a stale cache
			// can't silently swallow a start.
			if ( isSiteMutating( queryClient, STOP_SITE_MUTATION_KEY, id ) ) {
				return false;
			}
			await connector.startSite( id );
			await queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
			return true;
		},
		onSuccess: ( started ) => {
			if ( started && ! silent ) {
				toast.success( __( 'Site started' ) );
			}
		},
		onError: ( _error, id ) =>
			toast.error( getBusyMessage( queryClient, id, __( 'Failed to start site' ) ) ),
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
		onError: ( _error, id ) =>
			toast.error( getBusyMessage( queryClient, id, __( 'Failed to stop site' ) ) ),
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

export function useIsSiteMutating(
	siteId: string | undefined,
	mutationKey: readonly string[]
): boolean {
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

/**
 * Why an action on this site failed, worded from the operation on the cached
 * record. Only ever used to phrase an error that already happened, so a cache
 * that's a beat behind costs nothing — unlike using it to *decide*, which would
 * silently swallow the action.
 */
function getBusyMessage( queryClient: QueryClient, siteId: string, fallback: string ): string {
	const sites = queryClient.getQueryData< SiteDetails[] >( SITES_QUERY_KEY );
	const operation = sites?.find( ( site ) => site.id === siteId )?.operation?.kind;
	return operation
		? sprintf(
				/* translators: %s: an operation already running, e.g. "a settings change". */
				__( 'This site is busy: %s is in progress. Try again once it finishes.' ),
				getSiteOperationNoun( operation )
		  )
		: fallback;
}

export function useIsSiteStarting( siteId: string | undefined ): boolean {
	return useIsSiteMutating( siteId, START_SITE_MUTATION_KEY );
}

export function useIsSiteStopping( siteId: string | undefined ): boolean {
	return useIsSiteMutating( siteId, STOP_SITE_MUTATION_KEY );
}

/**
 * The operation currently holding the site, or null. Mostly read from the site
 * record the CLI writes, so it covers work the agent or another Studio window
 * started — not just this client's own mutations.
 *
 * Duplication is the exception: no CLI command performs it, so it's read from
 * the in-flight mutation. That only sees this window, which is enough because
 * a duplicate can't originate anywhere else.
 */
export function useSiteOperation( site: SiteDetails | undefined ): SiteOperationKind | null {
	const isDuplicating = useIsSiteMutating( site?.id, COPY_SITE_MUTATION_KEY );
	return site?.operation?.kind ?? ( isDuplicating ? 'duplicate' : null );
}

/**
 * Whether the site is mid-transition and its actions should be disabled. Folds
 * this client's in-flight start/stop — which lands before the CLI writes its
 * operation — into the CLI's authoritative view.
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
	const { mutate: startSite } = useStartSite( { silent: true } );
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
