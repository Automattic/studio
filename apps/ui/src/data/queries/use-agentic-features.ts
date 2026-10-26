import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	useUserPreferences,
	USER_PREFERENCES_QUERY_KEY,
} from '@/data/queries/use-user-preferences';
import { useOffline } from '@/lib/hooks';
import type { AuthUser, Connector } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

type AgenticFeatureReason = 'signed-out' | 'offline' | null;

interface AgenticFeatures {
	// Whether the host can reach the agentic backend at all (online + signed
	// in). Gates previews, sync and publishing.
	enabled: boolean;
	// Whether chat is on offer: the user hasn't switched agentic features off
	// in Settings → AI. Chats stay open offline and signed out: an Anthropic
	// key needs no WordPress.com account, and the composer says what's missing.
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
		chatEnabled: agenticFeaturesEnabled,
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

export async function resolveChatEnabled( context: {
	queryClient: QueryClient;
	connector: Connector;
} ): Promise< boolean > {
	const preferences = await context.queryClient.fetchQuery( {
		queryKey: USER_PREFERENCES_QUERY_KEY,
		queryFn: () => context.connector.getUserPreferences(),
	} );
	return preferences.agenticFeaturesEnabled;
}
