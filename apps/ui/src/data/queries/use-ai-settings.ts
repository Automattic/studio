import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import type { AiSettings } from '@studio/common/ai/providers';

export const AI_SETTINGS_QUERY_KEY = [ 'ai-settings' ] as const;

export function useAiSettings() {
	const connector = useConnector();
	return useQuery( {
		queryKey: AI_SETTINGS_QUERY_KEY,
		queryFn: () => connector.getAiSettings(),
		enabled: connector.capabilities.aiSettings,
		staleTime: Infinity,
	} );
}

// Saving a key switches new sessions to the direct Anthropic provider;
// passing null clears the key and falls back to WordPress.com.
export function useSaveAnthropicApiKey() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( key: string | null ) => connector.saveAnthropicApiKey( key ),
		onSuccess: ( settings ) => {
			queryClient.setQueryData< AiSettings >( AI_SETTINGS_QUERY_KEY, settings );
		},
	} );
}
