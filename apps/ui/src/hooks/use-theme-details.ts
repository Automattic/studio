import { useQuery } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { SiteDetails } from '@/data/core';

export type ThemeDetails = NonNullable< SiteDetails[ 'themeDetails' ] >;

/**
 * Whether a site's theme is known yet. "Unknown" is a real outcome, not an
 * error: a site the host can't inspect (hosted, or a stopped site the desktop
 * has never run) never resolves one, and callers should fall back rather than
 * wait forever.
 */
export type ThemeDetailsStatus =
	| { state: 'loading' }
	| { state: 'ready'; details: ThemeDetails }
	| { state: 'unknown' };

export const themeDetailsQueryKey = ( siteId: string ) => [ 'theme-details', siteId ] as const;

/**
 * The site's active theme, resolving it through the connector when the site
 * list didn't already carry it.
 *
 * Which Customize shortcuts a site offers depends on this, so surfaces should
 * show a loading state while it's pending instead of guessing — guessing means
 * rendering the classic-theme shortcuts for what is usually a block theme, then
 * swapping them out once the answer lands.
 */
export function useThemeDetails( site: SiteDetails ): ThemeDetailsStatus {
	const connector = useConnector();
	const persisted = site.themeDetails;

	const query = useQuery( {
		queryKey: themeDetailsQueryKey( site.id ),
		// React Query rejects `undefined` as data, and "the host doesn't know"
		// is a legitimate answer here, so it travels as null.
		queryFn: async () => ( await connector.getThemeDetails( site.id ) ) ?? null,
		enabled: ! persisted,
		// Resolving these is expensive on the CLI-backed host (a PHP run), and
		// once resolved they arrive with the site list. A short window still lets
		// a remount retry after a site that wasn't inspectable becomes one.
		staleTime: 30_000,
		retry: false,
	} );

	if ( persisted ) {
		return { state: 'ready', details: persisted };
	}
	if ( query.data ) {
		return { state: 'ready', details: query.data };
	}
	if ( query.isPending && ! query.isError ) {
		return { state: 'loading' };
	}
	return { state: 'unknown' };
}
