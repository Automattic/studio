import { readAuthToken, type StoredAuthToken } from '@studio/common/lib/shared-config';

export { getSignUpUrl } from '@studio/common/lib/oauth';

export async function getAuthenticationToken(): Promise< StoredAuthToken | null > {
	return readAuthToken();
}

export async function isAuthenticated(): Promise< boolean > {
	const token = await getAuthenticationToken();
	return !! token;
}
