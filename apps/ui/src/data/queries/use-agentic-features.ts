import { useConnector } from '@/data/core';
import { useAuthUser, AUTH_USER_QUERY_KEY } from '@/data/queries/use-auth-user';
import { useOffline } from '@/hooks/use-offline';
import type { AuthUser, Connector } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export type AgenticFeatureReason = 'signed-out' | 'offline' | null;

export interface AgenticFeatures {
	enabled: boolean;
	reason: AgenticFeatureReason;
}

export function deriveAgenticFeatures(
	connector: Pick< Connector, 'agenticRequiresAuth' >,
	user: AuthUser | null | undefined,
	isOffline = false
): AgenticFeatures {
	// Agentic features need the network regardless of the connector's auth
	// requirements, so offline wins over any auth state.
	if ( isOffline ) {
		return { enabled: false, reason: 'offline' };
	}
	if ( ! connector.agenticRequiresAuth ) {
		return { enabled: true, reason: null };
	}
	// `undefined` means the auth query hasn't resolved yet — keep features
	// disabled but without a reason, so signed-out UI (e.g. the sign-in
	// banner) doesn't flash for signed-in users while auth loads.
	if ( user === undefined ) {
		return { enabled: false, reason: null };
	}
	if ( ! user ) {
		return { enabled: false, reason: 'signed-out' };
	}
	return { enabled: true, reason: null };
}

export function useAgenticFeatures(): AgenticFeatures & { isReady: boolean } {
	const connector = useConnector();
	const isOffline = useOffline();
	const { data: user, isLoading } = useAuthUser();
	const features = deriveAgenticFeatures( connector, user, isOffline );
	return { ...features, isReady: ! isLoading };
}

export async function resolveAgenticFeatures( context: {
	queryClient: QueryClient;
	connector: Connector;
} ): Promise< AgenticFeatures > {
	// Skip the auth fetch offline — it could hang without a network.
	if ( ! navigator.onLine ) {
		return deriveAgenticFeatures( context.connector, undefined, true );
	}
	const user = await context.queryClient.fetchQuery( {
		queryKey: AUTH_USER_QUERY_KEY,
		queryFn: () => context.connector.getAuthUser(),
	} );
	return deriveAgenticFeatures( context.connector, user );
}
