import { useConnector } from '@/data/core';
import { useAuthUser, AUTH_USER_QUERY_KEY } from '@/data/queries/use-auth-user';
import type { AuthUser, Connector } from '@/data/core';
import type { QueryClient } from '@tanstack/react-query';

export type AgenticFeatureReason = 'signed-out' | null;

export interface AgenticFeatures {
	enabled: boolean;
	reason: AgenticFeatureReason;
}

export function deriveAgenticFeatures(
	connector: Pick< Connector, 'supportsAgenticOptOut' >,
	user: AuthUser | null | undefined
): AgenticFeatures {
	if ( ! connector.supportsAgenticOptOut ) {
		return { enabled: true, reason: null };
	}
	if ( ! user ) {
		return { enabled: false, reason: 'signed-out' };
	}
	return { enabled: true, reason: null };
}

export function useAgenticFeatures(): AgenticFeatures & { isReady: boolean } {
	const connector = useConnector();
	const { data: user, isLoading } = useAuthUser();
	const features = deriveAgenticFeatures( connector, user );
	return { ...features, isReady: ! isLoading };
}

export async function resolveAgenticFeatures( context: {
	queryClient: QueryClient;
	connector: Connector;
} ): Promise< AgenticFeatures > {
	const user = await context.queryClient.fetchQuery( {
		queryKey: AUTH_USER_QUERY_KEY,
		queryFn: () => context.connector.getAuthUser(),
	} );
	return deriveAgenticFeatures( context.connector, user );
}
