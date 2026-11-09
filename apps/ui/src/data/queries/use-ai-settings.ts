import { AI_PROVIDER_IDS, getAiProvider } from '@studio/agent/protocol/providers';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { useAuthUser } from './use-auth-user';
import type { AiProviderId, AiSettings } from '@studio/agent/protocol/providers';

const AI_SETTINGS_QUERY_KEY = [ 'ai-settings' ] as const;

export function useAiSettings() {
	const connector = useConnector();
	return useQuery( {
		queryKey: AI_SETTINGS_QUERY_KEY,
		queryFn: () => connector.getAiSettings(),
		staleTime: Infinity,
	} );
}

export function useAiProviderConnections() {
	const { data: settings } = useAiSettings();
	const { data: user } = useAuthUser();
	return AI_PROVIDER_IDS.filter( ( id ) =>
		getAiProvider( id ).connection.usesStudioAccount
			? !! user
			: settings?.connections[ id ].connected
	);
}

export function useSetAiProvider() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( provider: AiProviderId ) => connector.setAiProvider( provider ),
		onSuccess: ( settings ) => {
			queryClient.setQueryData< AiSettings >( AI_SETTINGS_QUERY_KEY, settings );
		},
	} );
}

export function useSaveAiProviderApiKey() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { provider, key }: { provider: AiProviderId; key: string | null } ) =>
			connector.saveAiProviderApiKey( provider, key ),
		onSuccess: ( settings ) => {
			queryClient.setQueryData< AiSettings >( AI_SETTINGS_QUERY_KEY, settings );
		},
	} );
}
