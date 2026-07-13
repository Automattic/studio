import {
	validateProposedSitePath,
	validateSelectedSitePath,
	type PathValidationResult,
} from '@studio/common/lib/site-path-validation';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import type { SiteDetails } from '@/data/core';

const PROPOSED_SITE_NAME_QUERY_KEY = [ 'proposedSiteName' ] as const;

/**
 * Custom domains already assigned to local sites, derived from the loaded site
 * list so the create/edit forms can flag conflicts before submit. The site list
 * already carries every site's `customDomain`, so no separate backend call is
 * needed.
 */
export function useExistingCustomDomains(): string[] {
	const { data: sites } = useSites();
	return useMemo(
		() =>
			( sites ?? [] )
				.map( ( site ) => site.customDomain )
				.filter( ( domain ): domain is string => !! domain ),
		[ sites ]
	);
}

/**
 * Asks the main process for a randomly-selected, non-colliding site name so
 * the create form can pre-fill "Site name" on first render. Skips until the
 * caller has loaded the current site list.
 */
export function useProposedSiteName( sites: SiteDetails[] | undefined ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: [ ...PROPOSED_SITE_NAME_QUERY_KEY, ( sites ?? [] ).map( ( s ) => s.id ) ],
		queryFn: () => connector.generateProposedSiteName( sites ?? [] ),
		enabled: !! sites,
		staleTime: Infinity,
	} );
}

/**
 * Returns two imperative helpers the create form uses to validate paths:
 *
 * - `generateProposedPath(name)` — derives the default directory for a given
 *   site name, checks whether it collides with an existing site, and whether
 *   it already contains WordPress.
 * - `selectPath(currentPath)` — opens the native folder picker and runs the
 *   same validation on the user's choice.
 */
export function usePathValidator( sites: SiteDetails[] | undefined ) {
	const connector = useConnector();

	const checkPathExists = useCallback(
		async ( path: string ): Promise< boolean > => {
			if ( ! sites?.length ) return false;
			const results = await Promise.all(
				sites.map( ( site ) => connector.comparePaths( site.path, path ) )
			);
			return results.some( Boolean );
		},
		[ connector, sites ]
	);

	const generateProposedPath = useCallback(
		async ( siteName: string ): Promise< PathValidationResult > => {
			const result = await connector.generateProposedSitePath( siteName );
			return validateProposedSitePath( result, await checkPathExists( result.path ) );
		},
		[ connector, checkPathExists ]
	);

	const selectPath = useCallback(
		async ( currentPath: string ): Promise< PathValidationResult | null > => {
			const response = await connector.selectSiteFolder( currentPath );
			if ( ! response ) return null;
			const exists = await checkPathExists( response.path );
			return validateSelectedSitePath( response, exists );
		},
		[ connector, checkPathExists ]
	);

	return { generateProposedPath, selectPath };
}
