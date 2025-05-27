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
