import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useConnector } from '@/data/core';
import { SITES_QUERY_KEY } from '@/data/queries/use-sites';
import type { Connector, SiteDetails } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export type ThemeDetails = NonNullable< SiteDetails[ 'themeDetails' ] >;

/**
 * Whether a site's theme is known yet. "Unknown" is a real outcome, not an
 * error: a host without theme inspection, or a stopped site without persisted
 * details, resolves to that state rather than loading forever.
 */
export type ThemeDetailsStatus =
	| { state: 'loading' }
	| { state: 'ready'; details: ThemeDetails }
	| { state: 'unknown' };

export const themeDetailsQueryKey = ( siteId: string ) => [ 'theme-details', siteId ] as const;

export async function fetchThemeDetails( connector: Connector, siteId: string ) {
	return ( await connector.getThemeDetails?.( siteId ) ) ?? null;
}

const themeRefreshVersions = new Map< string, number >();

export function refreshThemeDetails(
	connector: Connector,
	queryClient: QueryClient,
	siteId: string
): Promise< ThemeDetails | null > {
	const refreshVersion = ( themeRefreshVersions.get( siteId ) ?? 0 ) + 1;
	themeRefreshVersions.set( siteId, refreshVersion );

	return fetchThemeDetails( connector, siteId )
		.then( ( details ) => {
			if ( themeRefreshVersions.get( siteId ) !== refreshVersion ) {
				return details;
			}
			queryClient.setQueryData( themeDetailsQueryKey( siteId ), details );
			queryClient.setQueryData< SiteDetails[] >(
				SITES_QUERY_KEY,
				( sites ) =>
					sites?.map( ( site ) =>
						site.id === siteId ? { ...site, themeDetails: details ?? undefined } : site
					)
			);
			return details;
		} )
		.finally( () => {
			if ( themeRefreshVersions.get( siteId ) === refreshVersion ) {
				themeRefreshVersions.delete( siteId );
			}
		} );
}

function getThemeDetailsStatusKey( status: ThemeDetailsStatus ): string {
	if ( status.state !== 'ready' ) {
		return status.state;
	}
	return JSON.stringify( [
		status.details.name,
		status.details.slug,
		status.details.isBlockTheme,
		status.details.supportsMenus,
		status.details.supportsWidgets,
	] );
}

/**
 * The site's active theme, resolving through the host when the site list did
 * not already carry the persisted details. Desktop delegates to the same
 * `loadThemeDetails` IPC handler as Classic Studio.
 */
export function useThemeDetails( site: SiteDetails ): ThemeDetailsStatus {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const persisted = site.themeDetails;
	const canResolve = site.running && Boolean( connector.getThemeDetails );

	const { data, isError, isPending } = useQuery( {
		queryKey: themeDetailsQueryKey( site.id ),
		// React Query rejects `undefined` as data, and "the host doesn't know"
		// is a legitimate answer here, so it travels as null.
		queryFn: () => fetchThemeDetails( connector, site.id ),
		enabled: ! persisted && canResolve,
		staleTime: 30_000,
		retry: false,
	} );

	useEffect( () => {
		if ( ! canResolve ) {
			return;
		}

		const handleFocus = () => {
			void refreshThemeDetails( connector, queryClient, site.id ).catch( () => undefined );
		};
		window.addEventListener( 'focus', handleFocus );
		return () => window.removeEventListener( 'focus', handleFocus );
	}, [ canResolve, connector, queryClient, site.id ] );

	const resolvedStatus = useMemo< ThemeDetailsStatus >( () => {
		if ( persisted ) {
			return { state: 'ready', details: persisted };
		}
		if ( data ) {
			return { state: 'ready', details: data };
		}
		if ( ! canResolve ) {
			return { state: 'unknown' };
		}
		if ( isPending && ! isError ) {
			return { state: 'loading' };
		}
		return { state: 'unknown' };
	}, [ canResolve, data, isError, isPending, persisted ] );
	const resolvedKey = getThemeDetailsStatusKey( resolvedStatus );
	const [ displayed, setDisplayed ] = useState( () => ( {
		siteId: site.id,
		key: resolvedKey,
		status: resolvedStatus,
	} ) );

	useLayoutEffect( () => {
		if ( displayed.siteId === site.id && displayed.key === resolvedKey ) {
			return;
		}

		const next = { siteId: site.id, key: resolvedKey, status: resolvedStatus };
		const reduceMotion = window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches;
		if ( displayed.siteId === site.id && ! reduceMotion && document.startViewTransition ) {
			try {
				const transition = document.startViewTransition( {
					types: [ 'theme-details' ],
					update: () => flushSync( () => setDisplayed( next ) ),
				} );
				void transition.finished.catch( () => undefined );
				return;
			} catch {
				// Fall through when the document cannot start a transition.
			}
		}
		setDisplayed( next );
	}, [ displayed, resolvedKey, resolvedStatus, site.id ] );

	return displayed.siteId === site.id ? displayed.status : resolvedStatus;
}
