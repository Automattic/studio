import { useConnector } from '@/data/core';
import { AUTH_USER_QUERY_KEY, useAuthUser } from './use-auth-user';
import { USER_PREFERENCES_QUERY_KEY, useUserPreferences } from './use-user-preferences';
import type { AuthUser, Connector, UserPreferences } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export type AgenticGateReason = 'signed-out' | 'preference' | null;

export interface AgenticFeatures {
	enabled: boolean;
	reason: AgenticGateReason;
}

/**
 * Single source of truth for whether agentic features (chat/sessions) are
 * available. Connectors without opt-out support (hosted/web) are always-on;
 * otherwise features require a signed-in user who hasn't disabled them in
 * settings. The preference defaults to enabled when unset.
 */
export function deriveAgenticFeatures(
	connector: Pick< Connector, 'supportsAgenticOptOut' >,
	user: AuthUser | null | undefined,
	preferences: Pick< UserPreferences, 'agenticFeaturesEnabled' > | undefined
): AgenticFeatures {
	if ( ! connector.supportsAgenticOptOut ) {
		return { enabled: true, reason: null };
	}
	if ( ! user ) {
		return { enabled: false, reason: 'signed-out' };
	}
	if ( preferences?.agenticFeaturesEnabled === false ) {
		return { enabled: false, reason: 'preference' };
	}
	return { enabled: true, reason: null };
}

/**
 * Reactive gate for components. While the underlying queries are still
 * loading (`isReady: false`) the gate reports enabled, matching current
 * behavior — the route guards below use resolved values, so a wrong
 * navigation can't happen during that window.
 */
export function useAgenticFeatures(): AgenticFeatures & { isReady: boolean } {
	const connector = useConnector();
	const user = useAuthUser();
	const preferences = useUserPreferences();

	if ( ! connector.supportsAgenticOptOut ) {
		return { enabled: true, reason: null, isReady: true };
	}
	const isReady = ! user.isPending && ! preferences.isPending;
	if ( ! isReady ) {
		return { enabled: true, reason: null, isReady };
	}
	return { ...deriveAgenticFeatures( connector, user.data, preferences.data ), isReady };
}

/**
 * Gate resolver for route `beforeLoad` hooks. Fetches through the query
 * client with the same keys the hooks use, so results land in (and reuse)
 * the shared cache.
 */
export async function resolveAgenticFeatures( {
	connector,
	queryClient,
}: {
	connector: Connector;
	queryClient: QueryClient;
} ): Promise< AgenticFeatures > {
	if ( ! connector.supportsAgenticOptOut ) {
		return { enabled: true, reason: null };
	}
	const [ user, preferences ] = await Promise.all( [
		queryClient.fetchQuery( {
			queryKey: AUTH_USER_QUERY_KEY,
			queryFn: () => connector.getAuthUser(),
		} ),
		queryClient.fetchQuery( {
			queryKey: USER_PREFERENCES_QUERY_KEY,
			queryFn: () => connector.getUserPreferences(),
			staleTime: Infinity,
		} ),
	] );
	return deriveAgenticFeatures( connector, user, preferences );
}
