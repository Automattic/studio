import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useConnector, type Library } from '@/data/core';
import { useHostState } from '@/hooks/use-host-state';

export const LOCAL_SITES_QUERY_KEY = [ 'local-sites' ] as const;
export const WPCOM_SITES_QUERY_KEY = [ 'wpcom-sites' ] as const;
export const EMPTY_LIBRARY: Library = {
	localSites: [],
	wpcom: { signedIn: false, sites: [], error: '' },
};
// The host pushes the tool result that opened the library; give it this long
// before reading the sites directly (a sidebar entry or a restored tab).
const HOST_RESULT_GRACE_MS = 1500;
const SITE_CHANGES_RETRY_MS = 5000;

function useReadsEnabled() {
	const { status } = useHostState();
	const [ graceOver, setGraceOver ] = useState( false );
	useEffect( () => {
		if ( status !== 'ready' ) {
			return;
		}
		const timer = setTimeout( () => setGraceOver( true ), HOST_RESULT_GRACE_MS );
		return () => clearTimeout( timer );
	}, [ status ] );
	return status === 'ready' && graceOver;
}

export function useLocalSites() {
	const connector = useConnector();
	return useQuery( {
		queryKey: LOCAL_SITES_QUERY_KEY,
		queryFn: () => connector.readLocalSites(),
		enabled: useReadsEnabled(),
	} );
}

export function useWpcomSites() {
	const connector = useConnector();
	return useQuery( {
		queryKey: WPCOM_SITES_QUERY_KEY,
		queryFn: () => connector.readWpcomSites(),
		enabled: useReadsEnabled(),
	} );
}

export function useLibrary() {
	const local = useLocalSites();
	const wpcom = useWpcomSites();
	const data: Library | undefined =
		local.data && wpcom.data ? { localSites: local.data, wpcom: wpcom.data } : undefined;
	return {
		data,
		isPending: ! data,
		isError: local.isError || wpcom.isError,
		error: local.error ?? wpcom.error,
		refetch: () => Promise.all( [ local.refetch(), wpcom.refetch() ] ),
	};
}

export function readCachedLibrary( queryClient: ReturnType< typeof useQueryClient > ): Library {
	return {
		localSites: queryClient.getQueryData( LOCAL_SITES_QUERY_KEY ) ?? EMPTY_LIBRARY.localSites,
		wpcom: queryClient.getQueryData( WPCOM_SITES_QUERY_KEY ) ?? EMPTY_LIBRARY.wpcom,
	};
}

// Seeds both lists from the tool result that opened the library, and keeps the
// local sites fresh: any site change, from the agent, a terminal or the desktop
// app, refetches them.
export function useSyncLibraryWithHost() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const { status } = useHostState();

	useEffect(
		() =>
			connector.onLibraryResult( ( read ) => {
				try {
					const library = read();
					queryClient.setQueryData( LOCAL_SITES_QUERY_KEY, library.localSites );
					queryClient.setQueryData( WPCOM_SITES_QUERY_KEY, library.wpcom );
				} catch {
					// The direct reads take over once the grace period ends.
				}
			} ),
		[ connector, queryClient ]
	);

	useEffect( () => {
		if ( status !== 'ready' ) {
			return;
		}
		let stopped = false;
		let since: number | undefined;
		const watch = async () => {
			while ( ! stopped ) {
				try {
					const revision = await connector.waitForSiteChanges( since );
					if ( since !== undefined && revision !== since ) {
						void queryClient.invalidateQueries( { queryKey: LOCAL_SITES_QUERY_KEY } );
					}
					since = revision;
				} catch {
					await new Promise( ( resolve ) => setTimeout( resolve, SITE_CHANGES_RETRY_MS ) );
				}
			}
		};
		void watch();
		return () => {
			stopped = true;
		};
	}, [ status, connector, queryClient ] );
}
