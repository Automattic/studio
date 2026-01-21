/**
 * Extracts the hostname from a URL string.
 * @param url The URL string to extract the hostname from
 * @returns The hostname (domain and port if specified), or the passed url param if invalid
 */
export function getHostnameFromUrl( url: string ): string {
	try {
		const parsedUrl = new URL( url );
		return parsedUrl.hostname;
	} catch ( error ) {
		return url;
	}
}

/**
 * Adds query parameters to a URL. Does not override existing parameters.
 * @param url The URL string to add params to
 * @param params Object containing key-value pairs to add as query params
 * @returns The URL with params added, or the original URL if invalid
 */
export function addUrlParams( url: string, params: Record< string, string > ): string {
	try {
		const parsedUrl = new URL( url );

		for ( const [ key, value ] of Object.entries( params ) ) {
			if ( ! parsedUrl.searchParams.has( key ) ) {
				parsedUrl.searchParams.set( key, value );
			}
		}

		return parsedUrl.toString();
	} catch {
		return url;
	}
}
