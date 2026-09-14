import { PROTOCOL_PREFIX, CLIENT_ID } from '@studio/common/constants';
import { SupportedLocale } from '@studio/common/lib/locale';

const SCOPES = 'global';
const REDIRECT_URI = `${ PROTOCOL_PREFIX }://auth`;

export function getAuthenticationUrl(
	locale: SupportedLocale,
	redirectUri = REDIRECT_URI
): string {
	const url = new URL( 'https://public-api.wordpress.com/oauth2/authorize' );
	url.searchParams.set( 'response_type', 'token' );
	url.searchParams.set( 'client_id', CLIENT_ID );
	url.searchParams.set( 'redirect_uri', redirectUri );
	url.searchParams.set( 'scope', SCOPES );
	url.searchParams.set( 'locale', locale );

	return url.toString();
}

export function getSignUpUrl( locale: SupportedLocale, redirectUri?: string ): string {
	const url = new URL( 'https://wordpress.com/start/wpcc/oauth2-user' );
	url.searchParams.set( 'oauth2_client_id', CLIENT_ID );
	url.searchParams.set( 'oauth2_redirect', getAuthenticationUrl( locale, redirectUri ) );
	url.searchParams.set( 'locale', locale );
	return url.toString();
}
