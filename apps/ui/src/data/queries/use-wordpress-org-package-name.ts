import { useQuery } from '@tanstack/react-query';

type WordPressOrgPackageKind = 'plugin' | 'theme';

function decodeHtmlEntities( value: string ): string {
	const document = new DOMParser().parseFromString( value, 'text/html' );
	return document.documentElement.textContent ?? value;
}

export async function fetchWordPressOrgPackageName(
	kind: WordPressOrgPackageKind,
	slug: string
): Promise< string | null > {
	const endpoint = kind === 'plugin' ? 'plugins' : 'themes';
	const action = kind === 'plugin' ? 'plugin_information' : 'theme_information';
	const request = new URLSearchParams( {
		action,
		'request[slug]': slug,
	} );
	const response = await fetch( `https://api.wordpress.org/${ endpoint }/info/1.2/?${ request }` );
	if ( ! response.ok ) {
		throw new Error( `WordPress.org package request failed with ${ response.status }` );
	}
	const data: unknown = await response.json();
	if ( ! data || typeof data !== 'object' || ! ( 'name' in data ) ) {
		return null;
	}
	return typeof data.name === 'string' && data.name ? decodeHtmlEntities( data.name ) : null;
}

export function useWordPressOrgPackageName(
	kind: WordPressOrgPackageKind | undefined,
	slug: string | undefined
) {
	return useQuery( {
		queryKey: [ 'wordpress-org-package-name', 'decoded-v1', kind, slug ],
		queryFn: () => {
			if ( ! kind || ! slug ) {
				return null;
			}
			return fetchWordPressOrgPackageName( kind, slug );
		},
		enabled: Boolean( kind && slug ),
		select: ( name ) => ( name ? decodeHtmlEntities( name ) : null ),
		staleTime: Infinity,
		retry: 1,
	} );
}
