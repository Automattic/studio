import { useQuery } from '@tanstack/react-query';
import { __ } from '@wordpress/i18n';
import { useCallback, useMemo } from 'react';
import { useConnector } from '@/data/core';
import { useSites } from '@/data/queries/use-sites';
import type { ProposedSitePath, SelectedSiteFolder, SiteDetails } from '@/data/core';

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
			const result: ProposedSitePath = await connector.generateProposedSitePath( siteName );
			return validateProposedPath( result, await checkPathExists( result.path ) );
		},
		[ connector, checkPathExists ]
	);

	const selectPath = useCallback(
		async ( currentPath: string ): Promise< PathValidationResult | null > => {
			const response: SelectedSiteFolder | null = await connector.selectSiteFolder( currentPath );
			if ( ! response ) return null;
			const exists = await checkPathExists( response.path );
			return validateSelectedFolder( response, exists );
		},
		[ connector, checkPathExists ]
	);

	return { generateProposedPath, selectPath };
}

export interface PathValidationResult {
	path: string;
	name?: string;
	isEmpty: boolean;
	isWordPress: boolean;
	error?: string;
}

function validateProposedPath(
	result: ProposedSitePath,
	pathExists: boolean
): PathValidationResult {
	if ( result.isNameTooLong ) {
		return {
			path: result.path,
			isEmpty: result.isEmpty,
			isWordPress: result.isWordPress,
			error: __( 'The site name is too long. Please choose a shorter site name.' ),
		};
	}
	if ( pathExists ) {
		return {
			path: result.path,
			isEmpty: result.isEmpty,
			isWordPress: result.isWordPress,
			error: __(
				'The directory is already associated with another Studio site. Please choose a different site name or a custom local path.'
			),
		};
	}
	if ( ! result.isEmpty && ! result.isWordPress ) {
		return {
			path: result.path,
			isEmpty: result.isEmpty,
			isWordPress: result.isWordPress,
			error: __(
				'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
			),
		};
	}
	return { path: result.path, isEmpty: result.isEmpty, isWordPress: result.isWordPress };
}

function validateSelectedFolder(
	folder: SelectedSiteFolder,
	pathExists: boolean
): PathValidationResult {
	const base = {
		path: folder.path,
		name: folder.name,
		isEmpty: folder.isEmpty,
		isWordPress: folder.isWordPress,
	};
	if ( pathExists ) {
		return {
			...base,
			error: __(
				'The directory is already associated with another Studio site. Please choose a different custom local path.'
			),
		};
	}
	if ( ! folder.isEmpty && ! folder.isWordPress ) {
		return {
			...base,
			error: __(
				'This directory is not empty. Please select an empty directory or an existing WordPress folder.'
			),
		};
	}
	return base;
}
