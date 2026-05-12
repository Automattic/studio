import { getSiteUrl } from '@/lib/get-site-url';
import type { SiteDetails } from '@/data/core';

export function getSitePreviewUrl( site: SiteDetails | undefined, path: string ) {
	if ( ! site?.running ) {
		return '';
	}

	return resolvePreviewPath( getSiteUrl( site ), path );
}

export function withPreviewFlag( url: string ): string {
	try {
		const previewUrl = new URL( url, window.location.origin );
		previewUrl.searchParams.set( 'studio_desk_preview', '1' );
		return previewUrl.toString();
	} catch {
		return `${ url }${ url.includes( '?' ) ? '&' : '?' }studio_desk_preview=1`;
	}
}

export function urlLabelFor( url: string ): string {
	if ( ! url ) {
		return '';
	}

	try {
		const previewUrl = new URL( url, window.location.origin );
		previewUrl.searchParams.delete( 'studio_desk_preview' );
		const path = previewUrl.pathname === '/' ? '' : previewUrl.pathname;
		const query = previewUrl.searchParams.toString();
		return `${ previewUrl.host }${ path }${ query ? `?${ query }` : '' }${ previewUrl.hash }`;
	} catch {
		return url.replace( /^https?:\/\//, '' );
	}
}

function resolvePreviewPath( siteUrl: string, path: string ) {
	const trimmedPath = path.trim();
	if ( /^https?:\/\//.test( trimmedPath ) ) {
		return trimmedPath;
	}

	const normalizedPath = trimmedPath.startsWith( '/' ) ? trimmedPath : `/${ trimmedPath || '' }`;
	return new URL( normalizedPath || '/', `${ siteUrl }/` ).toString();
}
