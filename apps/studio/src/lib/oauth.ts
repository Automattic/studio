import { CLIENT_ID } from '@studio/common/constants';
import { SupportedLocale } from '@studio/common/lib/locale';
import { getAuthenticationUrl } from '@studio/common/lib/oauth';
import { readAuthToken, type StoredAuthToken } from '@studio/common/lib/shared-config';

export type { StoredAuthToken } from '@studio/common/lib/shared-config';

export function getSignUpUrl( locale: SupportedLocale ) {
	const oauth2Redirect = encodeURIComponent( getAuthenticationUrl( locale ) );
	return `https://wordpress.com/start/wpcc/oauth2-user?oauth2_client_id=${ CLIENT_ID }&oauth2_redirect=${ oauth2Redirect }&locale=${ locale }`;
}

export async function getAuthenticationToken(): Promise< StoredAuthToken | null > {
	return readAuthToken();
}

export async function isAuthenticated(): Promise< boolean > {
	const token = await getAuthenticationToken();
	return !! token;
}
