import { AI_PROVIDER_IDS, getProviderDescriptor } from '@studio/providers';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { ACCOUNT_SITES_QUERY_KEY } from '@/data/queries/user-scoped-query-keys';
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
		// Read each launch: a saved copy may come from a build with other providers.
		meta: { persist: false },
	} );
}

// Whether a provider that serves AI models is connected.
export function hasConnectedProvider( settings: AiSettings | undefined ): boolean {
	return AI_PROVIDER_IDS.some( ( id ) => settings?.accounts[ id ].connected );
}

// The sites of the account a provider was connected to are no longer the ones it has.
function setProviderSettings(
	queryClient: ReturnType< typeof useQueryClient >,
	provider: ProviderId,
	settings: AiSettings
) {
	queryClient.setQueryData< AiSettings >( AI_SETTINGS_QUERY_KEY, settings );
	queryClient.removeQueries( { queryKey: [ ...ACCOUNT_SITES_QUERY_KEY, provider ] } );
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
		onSuccess: ( settings ) => setProviderSettings( queryClient, provider, settings ),
	} );
}

export function useDisconnectProvider( provider: ProviderId ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.disconnectProvider( provider ),
		onSuccess: ( settings ) => setProviderSettings( queryClient, provider, settings ),
	} );
}

// Signing in on the provider's site: a device sign-in shows where to approve the code, and a
// loopback one waits for the browser to come back. Resolves once the user is signed in.
export function useSignIn( provider: ProviderId ) {
	const connector = useConnector();
	const connect = useConnectProvider( provider );
	const [ authorization, setAuthorization ] = useState< DeviceAuthorization | null >( null );
	const signIn = useMutation( {
		mutationFn: async () => {
			if ( getProviderDescriptor( provider ).connection.kind === 'loopback' ) {
				return connect.mutateAsync( {} );
			}
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
