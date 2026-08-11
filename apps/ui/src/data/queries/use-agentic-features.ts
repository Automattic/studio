import { useConnector } from '@/data/core';
import { useOffline } from '@/hooks/use-offline';
import { AUTH_USER_QUERY_KEY, useAuthUser } from './use-auth-user';
import { USER_PREFERENCES_QUERY_KEY, useUserPreferences } from './use-user-preferences';
import type { AuthUser, Connector, UserPreferences } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export type AgenticGateReason = 'signed-out' | 'offline' | null;
export type AgenticFeatureReason = AgenticGateReason;

export interface AgenticFeatures {
	// Network/auth availability for previews, sync, publishing, and chat.
	enabled: boolean;
	// Chat availability additionally honors the user's agentic-features preference.
	chatEnabled: boolean;
	reason: AgenticGateReason;
}

/**
 * Single source of truth for agentic backend availability and chat visibility.
 * Turning chat off does not disable previews, sync, or publishing.
 */
export function deriveAgenticFeatures(
	connector: Pick< Connector, 'supportsAgenticOptOut' >,
	user: AuthUser | null | undefined,
	preferences: Pick< UserPreferences, 'agenticFeaturesEnabled' > | undefined,
	isOffline = false
): AgenticFeatures {
	if ( isOffline ) {
		return { enabled: false, chatEnabled: false, reason: 'offline' };
	}
	if ( connector.supportsAgenticOptOut && ! user ) {
		return { enabled: false, chatEnabled: false, reason: 'signed-out' };
	}
	return {
		enabled: true,
		chatEnabled: preferences?.agenticFeaturesEnabled !== false,
		reason: null,
	};
}

/**
 * Reactive gate for components. While the underlying queries are still
 * loading (`isReady: false`) the gate reports enabled, matching current
 * behavior — the route guards below use resolved values, so a wrong
 * navigation can't happen during that window.
 */
export function useAgenticFeatures(): AgenticFeatures & { isReady: boolean } {
	const connector = useConnector();
	const isOffline = useOffline();
	const user = useAuthUser();
	const preferences = useUserPreferences();

	const isReady =
		! preferences.isPending && ( ! connector.supportsAgenticOptOut || ! user.isPending );
	if ( ! isReady ) {
		return { enabled: true, chatEnabled: true, reason: null, isReady };
	}
	return {
		...deriveAgenticFeatures( connector, user.data, preferences.data, isOffline ),
		isReady,
	};
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
	if ( ! navigator.onLine ) {
		return deriveAgenticFeatures( connector, undefined, undefined, true );
	}
	const preferencesPromise = queryClient.fetchQuery( {
		queryKey: USER_PREFERENCES_QUERY_KEY,
		queryFn: () => connector.getUserPreferences(),
		staleTime: Infinity,
	} );
	const userPromise = connector.supportsAgenticOptOut
		? queryClient.fetchQuery( {
				queryKey: AUTH_USER_QUERY_KEY,
				queryFn: () => connector.getAuthUser(),
		  } )
		: Promise.resolve( null );
	const [ user, preferences ] = await Promise.all( [ userPromise, preferencesPromise ] );
	return deriveAgenticFeatures( connector, user, preferences );
}
