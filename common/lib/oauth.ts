import { PROTOCOL_PREFIX, WP_AUTHORIZE_ENDPOINT, CLIENT_ID, SCOPES } from 'common/constants';

const REDIRECT_URI = `${ PROTOCOL_PREFIX }://auth`;

export function getAuthenticationUrl(): string {
	return `${ WP_AUTHORIZE_ENDPOINT }?response_type=token&client_id=${ CLIENT_ID }&redirect_uri=${ encodeURIComponent(
		REDIRECT_URI
	) }&scope=${ encodeURIComponent( SCOPES ) }`;
}
