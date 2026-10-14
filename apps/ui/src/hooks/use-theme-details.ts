import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useConnector } from '@/data/core';
import type { SiteDetails, ThemeDetails } from '@/data/core';

/**
 * Whether a site's theme is known yet. "Unknown" is a real outcome, not an
 * error: a host without theme inspection resolves to that state rather than
 * loading forever.
 */
type ThemeDetailsStatus =
	| { state: 'loading' }
	| { state: 'ready'; details: ThemeDetails }
	| { state: 'unknown' };

export const themeDetailsQueryKey = ( siteId: string ) => [ 'theme-details', siteId ] as const;

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

/** The site's active theme, read through the host on demand. */
export function useThemeDetails( site: SiteDetails ): ThemeDetailsStatus {
	const connector = useConnector();
	const canResolve = Boolean( connector.getThemeDetails );

	const { data, isPending } = useQuery( {
		queryKey: themeDetailsQueryKey( site.id ),
		// React Query rejects `undefined` as data, so a host without the capability answers null.
		queryFn: async () => ( await connector.getThemeDetails?.( site.id ) ) ?? null,
		enabled: canResolve,
		staleTime: 30_000,
		retry: false,
	} );

	const resolvedStatus = useMemo< ThemeDetailsStatus >( () => {
		if ( data ) {
			return { state: 'ready', details: data };
		}
		return canResolve && isPending ? { state: 'loading' } : { state: 'unknown' };
	}, [ canResolve, data, isPending ] );
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
