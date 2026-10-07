import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
	onLocalSitesResult,
	readLocalSites,
	readWpcomSites,
	waitForSiteChanges,
} from '@/data/bridge';
import { useHostState } from '@/hooks/use-host-state';

export const LOCAL_SITES_QUERY_KEY = [ 'local-sites' ] as const;
export const WPCOM_SITES_QUERY_KEY = [ 'wpcom-sites' ] as const;
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
	return useQuery( {
		queryKey: LOCAL_SITES_QUERY_KEY,
		queryFn: readLocalSites,
		enabled: useReadsEnabled(),
	} );
}

export function useWpcomSites() {
	return useQuery( {
		queryKey: WPCOM_SITES_QUERY_KEY,
		queryFn: readWpcomSites,
		enabled: useHostState().status === 'ready',
	} );
}

// Seeds the sites from the tool result that opened the library, and keeps them
// fresh: any local site change, from the agent, a terminal or the desktop app,
// refetches them.
export function useSyncSitesWithHost() {
	const queryClient = useQueryClient();
	const { status } = useHostState();

	useEffect(
		() =>
			onLocalSitesResult( ( read ) => {
				try {
					queryClient.setQueryData( LOCAL_SITES_QUERY_KEY, read() );
				} catch {
					// The direct read takes over once the grace period ends.
				}
			} ),
		[ queryClient ]
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
					const revision = await waitForSiteChanges( since );
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
	}, [ status, queryClient ] );
}
