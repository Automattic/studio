import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import type { SiteDetails } from '@/data/core';

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

/**
 * The site's active theme, resolving through the host when the site list did
 * not already carry the persisted details. Desktop delegates to the same
 * `loadThemeDetails` IPC handler as Classic Studio.
 */
export function useThemeDetails( site: SiteDetails ): ThemeDetailsStatus {
	const connector = useConnector();
	const persisted = site.themeDetails;
	const canResolve = site.running && Boolean( connector.getThemeDetails );

	const { data, isError, isPending, refetch } = useQuery( {
		queryKey: themeDetailsQueryKey( site.id ),
		// React Query rejects `undefined` as data, and "the host doesn't know"
		// is a legitimate answer here, so it travels as null.
		queryFn: async () => ( await connector.getThemeDetails?.( site.id ) ) ?? null,
		enabled: ! persisted && canResolve,
		staleTime: 30_000,
		retry: false,
	} );

	useEffect( () => {
		if ( ! canResolve ) {
			return;
		}

		const refreshThemeDetails = () => {
			void refetch();
		};
		window.addEventListener( 'focus', refreshThemeDetails );
		return () => window.removeEventListener( 'focus', refreshThemeDetails );
	}, [ canResolve, refetch ] );

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
}
