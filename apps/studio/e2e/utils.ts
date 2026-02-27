export function getUrlWithAutoLogin( destinationUrl: string ): string {
	const parsedUrl = new URL( destinationUrl );
	const baseUrl = `${ parsedUrl.protocol }//${ parsedUrl.hostname }:${ parsedUrl.port }`;
	// Ensure directory-like paths have a trailing slash to avoid an extra redirect
	// through WordPress's index.php which can produce empty responses.
	let pathname = parsedUrl.pathname;
	if ( ! pathname.endsWith( '/' ) && ! pathname.includes( '.' ) ) {
		pathname += '/';
	}
	const relativePath = pathname + parsedUrl.search + parsedUrl.hash;
	return `${ baseUrl }/studio-auto-login?redirect_to=${ encodeURIComponent( relativePath ) }`;
}
