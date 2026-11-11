import type { RedirectOptions } from '../types';

// Studio's OAuth app on WordPress.com.
const CLIENT_ID = '95109';

// The implicit grant: WordPress.com sends the token back in the redirect's
// fragment, with `expires_in` and the `state` it was given.
export function getAuthorizeUrl( { redirectUri, locale, state, signup }: RedirectOptions ): string {
	const url = new URL( 'https://public-api.wordpress.com/oauth2/authorize' );
	url.searchParams.set( 'response_type', 'token' );
	url.searchParams.set( 'client_id', CLIENT_ID );
	url.searchParams.set( 'redirect_uri', redirectUri );
	url.searchParams.set( 'scope', 'global' );
	url.searchParams.set( 'locale', locale );
	if ( state ) {
		url.searchParams.set( 'state', state );
	}
	if ( ! signup ) {
		return url.toString();
	}
	const signupUrl = new URL( 'https://wordpress.com/start/wpcc/oauth2-user' );
	signupUrl.searchParams.set( 'oauth2_client_id', CLIENT_ID );
	signupUrl.searchParams.set( 'oauth2_redirect', url.toString() );
	signupUrl.searchParams.set( 'locale', locale );
	return signupUrl.toString();
}
