import { readAuthToken, type StoredAuthToken } from '@studio/common/lib/auth-token';

export async function getAuthenticationToken(): Promise< StoredAuthToken | null > {
	return readAuthToken();
}

export async function isAuthenticated(): Promise< boolean > {
	const token = await getAuthenticationToken();
	return !! token;
}
