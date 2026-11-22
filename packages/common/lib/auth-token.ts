import { isAutomatticianEmail } from './automattician';
import { readConfig } from './config/store';
import { providerConfigFrom } from './provider-config';
import type { StoredAuthToken } from './auth-token-schema';
import type { Config } from './config/schema';

export type { StoredAuthToken } from './auth-token-schema';

// The Studio sign-in in `stored`: the WordPress.com provider's config, or null when signed out or
// expired.
export function authTokenFrom( stored: Config ): StoredAuthToken | null {
	const config = providerConfigFrom( stored, 'wpcom' );
	if ( ! config?.user ) {
		return null;
	}
	const expirationTime = config.expiresAt ?? Number.MAX_SAFE_INTEGER;
	return {
		accessToken: config.token,
		expirationTime,
		expiresIn: Math.round( ( expirationTime - Date.now() ) / 1000 ),
		...config.user,
	};
}

export async function readAuthToken(): Promise< StoredAuthToken | null > {
	return authTokenFrom( await readConfig() );
}

export async function getCurrentUserId(): Promise< number | null > {
	const token = await readAuthToken();
	return token?.id ?? null;
}

// Best-effort Automattician flag for the shared `is_a11n` Tracks property, from the signed-in
// account's email domain. No network call, so it can run on every event.
export async function isAutomatticianFromToken(): Promise< boolean > {
	return isAutomatticianEmail( ( await readAuthToken() )?.email );
}
