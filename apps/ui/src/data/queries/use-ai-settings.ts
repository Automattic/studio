import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import type { AiSettings } from '@studio/common/lib/ai-settings';
import type { AiProviderId, DeviceAuthorization, ProviderId } from '@studio/providers';

// The WordPress.com account is the sign-in, so auth changes refresh it too.
export const AI_SETTINGS_QUERY_KEY = [ 'ai-settings' ] as const;

export function useAiSettings() {
	const connector = useConnector();
	return useQuery( {
		queryKey: AI_SETTINGS_QUERY_KEY,
		queryFn: () => connector.getAiSettings(),
		staleTime: Infinity,
	} );
}

export function hasConnectedProvider( settings: AiSettings | undefined ): boolean {
	return Object.values( settings?.accounts ?? {} ).some( ( account ) => account.connected );
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

export function useConnectProvider( provider: ProviderId ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( input: Record< string, string > ) => connector.connectProvider( provider, input ),
		onSuccess: ( settings ) => {
			queryClient.setQueryData< AiSettings >( AI_SETTINGS_QUERY_KEY, settings );
		},
	} );
}

export function useDisconnectProvider( provider: ProviderId ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.disconnectProvider( provider ),
		onSuccess: ( settings ) => {
			queryClient.setQueryData< AiSettings >( AI_SETTINGS_QUERY_KEY, settings );
		},
	} );
}

// A device sign-in: shows where to approve the code, and resolves once the user approves it.
export function useDeviceSignIn( provider: ProviderId ) {
	const connector = useConnector();
	const connect = useConnectProvider( provider );
	const [ authorization, setAuthorization ] = useState< DeviceAuthorization | null >( null );
	const signIn = useMutation( {
		mutationFn: async () => {
			const started = await connector.startProviderConnect( provider );
			setAuthorization( started );
			void connector.openExternalUrl( started.verificationUrl );
			return connect.mutateAsync( {
				deviceCode: started.deviceCode,
				interval: String( started.interval ),
				expiresAt: started.expiresAt,
			} );
		},
		onSettled: () => setAuthorization( null ),
	} );
	return { ...signIn, authorization };
}
