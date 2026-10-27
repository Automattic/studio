import { useConnector } from '@/data/core';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { useOffline } from '@/lib/hooks';
import type { AuthUser, Connector } from '@/data/core';

type AgenticFeatureReason = 'signed-out' | 'offline' | null;

interface AgenticFeatures {
	// Whether the host can reach the agentic backend at all (online + signed
	// in). Gates previews, sync and publishing.
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
	return { ...deriveAgenticFeatures( connector, user, isOffline ), isReady: ! isLoading };
}
