import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useConnector } from '@/data/core';
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

const activeThemeRefreshes = new Map< string, Promise< ThemeDetails | null > >();

export function refreshThemeDetails(
	connector: Connector,
	queryClient: QueryClient,
	siteId: string
): Promise< ThemeDetails | null > {
	const activeRefresh = activeThemeRefreshes.get( siteId );
	if ( activeRefresh ) {
		return activeRefresh;
	}

	const refresh = fetchThemeDetails( connector, siteId )
		.then( ( details ) => {
			queryClient.setQueryData( themeDetailsQueryKey( siteId ), details );
			return details;
		} )
		.finally( () => activeThemeRefreshes.delete( siteId ) );

	activeThemeRefreshes.set( siteId, refresh );
	return refresh;
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
		if ( data ) {
			return { state: 'ready', details: data };
		}
		if ( persisted ) {
			return { state: 'ready', details: persisted };
		}
		if ( ! canResolve ) {
			return { state: 'unknown' };
		}
		if ( isPending && ! isError ) {
			return { state: 'loading' };
		}
		return { state: 'unknown' };
	}, [ canResolve, data, isError, isPending, persisted ] );
	const resolvedKey =
		resolvedStatus.state === 'ready'
			? [
					resolvedStatus.details.slug,
					resolvedStatus.details.isBlockTheme,
					resolvedStatus.details.supportsMenus,
					resolvedStatus.details.supportsWidgets,
			  ].join( ':' )
			: resolvedStatus.state;
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
			const transition = document.startViewTransition( {
				types: [ 'theme-details' ],
				update: () => flushSync( () => setDisplayed( next ) ),
			} );
			void transition.finished.catch( () => undefined );
			return;
		}
		setDisplayed( next );
	}, [ displayed, resolvedKey, resolvedStatus, site.id ] );

	return displayed.siteId === site.id ? displayed.status : resolvedStatus;
}
