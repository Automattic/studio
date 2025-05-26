import { PROTOCOL_PREFIX, CLIENT_ID } from 'common/constants';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';

const SCOPES = 'global';
const REDIRECT_URI = `${ PROTOCOL_PREFIX }://auth`;

export async function getAuthenticationUrl(): Promise< string > {
	const url = new URL( 'https://public-api.wordpress.com/oauth2/authorize' );
	url.searchParams.set( 'response_type', 'token' );
	url.searchParams.set( 'client_id', CLIENT_ID );
	url.searchParams.set( 'redirect_uri', REDIRECT_URI );
	url.searchParams.set( 'scope', SCOPES );

	const locale = await getUserLocaleWithFallback();
	url.searchParams.set( 'locale', locale );

	return url.toString();
}
