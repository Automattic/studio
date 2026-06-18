/**
 * Shared request routing for headless sites: which request paths belong to the WordPress backend
 * (and must be proxied to `wpPort`) versus the static frontend. Used by both the frontend server
 * child and the custom-domain proxy so the two agree on what "a WordPress request" is.
 */

export const WORDPRESS_PATH_PREFIXES = [
	'/wp-json',
	'/wp-admin',
	'/wp-login.php',
	'/wp-content',
	'/wp-includes',
	'/wp-cron.php',
	'/xmlrpc.php',
	// Studio mu-plugin auth endpoint, so wp-admin auto-login works through the frontend.
	'/studio-auto-login',
];

/**
 * Whether a request URL (path + optional query) targets the WordPress backend rather than the
 * static frontend.
 */
export function isWordPressRequest( reqUrl: string ): boolean {
	const pathname = reqUrl.split( '?' )[ 0 ];
	if ( WORDPRESS_PATH_PREFIXES.some( ( prefix ) => pathname.startsWith( prefix ) ) ) {
		return true;
	}
	// Pretty-permalinks-disabled REST requests use ?rest_route=…
	return reqUrl.includes( 'rest_route=' );
}
