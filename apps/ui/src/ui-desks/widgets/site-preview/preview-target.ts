export function getSitePreviewPathFromContentLink( link: string, baseUrl?: string ) {
	const trimmed = link.trim();
	if ( ! trimmed ) {
		return '';
	}

	try {
		const previewUrl = new URL( trimmed, getBaseUrl( baseUrl ) );
		previewUrl.searchParams.delete( 'studio_desk_preview' );
		const query = previewUrl.searchParams.toString();
		return `${ previewUrl.pathname || '/' }${ query ? `?${ query }` : '' }${ previewUrl.hash }`;
	} catch {
		return trimmed.startsWith( '/' ) ? trimmed : `/${ trimmed }`;
	}
}

function getBaseUrl( baseUrl?: string ) {
	if ( baseUrl ) {
		return baseUrl.endsWith( '/' ) ? baseUrl : `${ baseUrl }/`;
	}

	if ( typeof window !== 'undefined' && window.location?.origin ) {
		return window.location.origin;
	}

	return 'http://localhost/';
}
