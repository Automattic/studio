import { AI_PROVIDER_IDS, getConnectMethod } from '@studio/providers';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useConnector } from '@/data/core';
import { ACCOUNT_SITES_QUERY_KEY } from '@/data/queries/user-scoped-query-keys';
import type { AiSettings } from '@studio/common/lib/ai-settings';
import type { AiProviderId, PendingConnect, ProviderId } from '@studio/providers';

// The WordPress.com account is the sign-in, so auth changes refresh it too.
export const AI_SETTINGS_QUERY_KEY = [ 'ai-settings' ] as const;

export function useAiSettings() {
	const connector = useConnector();
	return useQuery( {
		queryKey: AI_SETTINGS_QUERY_KEY,
		queryFn: () => connector.getAiSettings(),
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

export function useDisconnectProvider( provider: ProviderId ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: () => connector.disconnectProvider( provider ),
		onSuccess: ( settings ) => setProviderSettings( queryClient, provider, settings ),
	} );
}

// Connects the provider with `method`: a form's values, or a sign-in on the provider's site, which
// opens it, shows where the user signs in (`pending`), and resolves once they did.
export function useConnectProvider( provider: ProviderId ) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const [ pending, setPending ] = useState< PendingConnect | null >( null );
	const mutation = useMutation( {
		mutationFn: async ( {
			method,
			input = {},
		}: {
			method: string;
			input?: Record< string, string >;
		} ) => {
			if ( getConnectMethod( provider, method ).kind === 'form' ) {
				return connector.connectProvider( provider, method, input );
			}
			const started = await connector.startProviderConnect( provider, method );
			setPending( started );
			void connector.openExternalUrl( started.url );
			try {
				return await connector.connectProvider( provider, method, started.handoff );
			} finally {
				// Signing in again started another attempt, which owns `pending` now.
				setPending( ( current ) => ( current === started ? null : current ) );
			}
		},
		onSuccess: ( settings ) => setProviderSettings( queryClient, provider, settings ),
	} );
	return { ...mutation, pending };
}
