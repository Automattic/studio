import { useConnector } from '@/data/core';
import { useAuthUser, AUTH_USER_QUERY_KEY } from '@/data/queries/use-auth-user';
import {
	useUserPreferences,
	USER_PREFERENCES_QUERY_KEY,
} from '@/data/queries/use-user-preferences';
import { useOffline } from '@/hooks/use-offline';
import type { AuthUser, Connector } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export type AgenticFeatureReason = 'signed-out' | 'offline' | null;

export interface AgenticFeatures {
	// Whether the host can reach the agentic backend at all (online + signed
	// in). Gates everything that needs it, chat included, plus previews,
	// sync and publishing.
	enabled: boolean;
	// Whether chat is on offer: `enabled`, and the user hasn't switched
	// agentic features off in Settings → AI. Non-chat networked features stay
	// available when they do, so gate those on `enabled` instead.
	chatEnabled: boolean;
	reason: AgenticFeatureReason;
}

export function deriveAgenticFeatures(
	connector: Pick< Connector, 'agenticRequiresAuth' >,
	user: AuthUser | null | undefined,
	isOffline = false,
	agenticFeaturesEnabled = true
): AgenticFeatures {
	const withChat = ( features: Omit< AgenticFeatures, 'chatEnabled' > ): AgenticFeatures => ( {
		...features,
		chatEnabled: features.enabled && agenticFeaturesEnabled,
	} );
	// Agentic features need the network regardless of the connector's auth
	// requirements, so offline wins over any auth state.
	if ( isOffline ) {
		return withChat( { enabled: false, reason: 'offline' } );
	}
	if ( ! connector.agenticRequiresAuth ) {
		return withChat( { enabled: true, reason: null } );
	}
	// `undefined` means the auth query hasn't resolved yet — keep features
	// disabled but without a reason, so signed-out UI (e.g. the sign-in
	// banner) doesn't flash for signed-in users while auth loads.
	if ( user === undefined ) {
		return withChat( { enabled: false, reason: null } );
	}
	if ( ! user ) {
		return withChat( { enabled: false, reason: 'signed-out' } );
	}
	return withChat( { enabled: true, reason: null } );
}

export function useAgenticFeatures(): AgenticFeatures & { isReady: boolean } {
	const connector = useConnector();
	const isOffline = useOffline();
	const { data: user, isLoading } = useAuthUser();
	const { data: preferences, isLoading: preferencesLoading } = useUserPreferences();
	const features = deriveAgenticFeatures(
		connector,
		user,
		isOffline,
		preferences?.agenticFeaturesEnabled ?? true
	);
	return { ...features, isReady: ! isLoading && ! preferencesLoading };
}

export async function resolveAgenticFeatures( context: {
	queryClient: QueryClient;
	connector: Connector;
} ): Promise< AgenticFeatures > {
	const preferences = await context.queryClient.fetchQuery( {
		queryKey: USER_PREFERENCES_QUERY_KEY,
		queryFn: () => context.connector.getUserPreferences(),
	} );
	// Skip the auth fetch offline — it could hang without a network.
	if ( ! navigator.onLine ) {
		return deriveAgenticFeatures(
			context.connector,
			undefined,
			true,
			preferences.agenticFeaturesEnabled
		);
	}
	const user = await context.queryClient.fetchQuery( {
		queryKey: AUTH_USER_QUERY_KEY,
		queryFn: () => context.connector.getAuthUser(),
	} );
	return deriveAgenticFeatures(
		context.connector,
		user,
		false,
		preferences.agenticFeaturesEnabled
	);
}
