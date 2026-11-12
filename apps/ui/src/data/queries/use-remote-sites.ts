import {
	getSitesDescriptor,
	SITES_PROVIDER_IDS,
	type ProviderSites,
	type SitesProviderId,
} from '@studio/providers';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useConnector } from '@/data/core';
import { AI_SETTINGS_QUERY_KEY, useAiSettings } from '@/data/queries/use-ai-settings';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	ACCOUNT_SITES_QUERY_KEY,
	REMOTE_SITES_QUERY_KEY,
} from '@/data/queries/user-scoped-query-keys';
import type { RemoteSiteConnection } from '@/data/core';

export const remoteSitesQueryKey = ( provider: SitesProviderId, localSiteId?: string ) =>
	[ ...REMOTE_SITES_QUERY_KEY, provider, localSiteId ?? null ] as const;

export const accountSitesQueryKey = ( provider: SitesProviderId ) =>
	[ ...ACCOUNT_SITES_QUERY_KEY, provider ] as const;

// The providers this app publishes to: one that publishes a static export needs the site to run
// on native PHP.
export function usePublishProviders(): SitesProviderId[] {
	const { capabilities } = useConnector();
	return SITES_PROVIDER_IDS.filter(
		( id ) => capabilities.nativeSites || ! getSitesDescriptor( id ).exportsStaticSite
	);
}

// Whether the provider's account is connected. WordPress.com's is the Studio sign-in.
export function useProviderConnected( provider: SitesProviderId ): boolean | undefined {
	const { data: authUser, isSuccess } = useAuthUser();
	const settings = useAiSettings();
	if ( provider === 'wpcom' ) {
		return isSuccess ? !! authUser : undefined;
	}
	return settings.data?.accounts[ provider ].connected;
}

// The local site's connections to the provider's sites. The connector answers for any provider;
// what it returns is the provider's own sites.
export function useRemoteSites< Id extends SitesProviderId >(
	provider: Id,
	localSiteId: string | undefined
) {
	const connector = useConnector();
	return useQuery( {
		queryKey: remoteSitesQueryKey( provider, localSiteId ?? '' ),
		queryFn: async () =>
			( await connector.getRemoteSites( provider, localSiteId! ) ) as RemoteSiteConnection< Id >[],
		enabled: !! localSiteId,
	} );
}

// Every site the provider's account can connect a local site to.
export function useAccountSites< Id extends SitesProviderId >(
	provider: Id,
	options: { enabled?: boolean } = {}
) {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const connected = useProviderConnected( provider );
	const query = useQuery( {
		queryKey: accountSitesQueryKey( provider ),
		queryFn: async () => ( await connector.listAccountSites( provider ) ) as ProviderSites[ Id ][],
		enabled: ( options.enabled ?? true ) && !! connected,
		// This query hits the network and the data doesn't change often.
		// Keep it fresh for a few minutes so opening/closing the picker
		// repeatedly doesn't spam the provider.
		staleTime: 5 * 60 * 1000,
	} );
	// A provider that rejects its config forgets it, which disconnects the account.
	const { error } = query;
	useEffect( () => {
		if ( error ) {
			void queryClient.invalidateQueries( { queryKey: AI_SETTINGS_QUERY_KEY } );
		}
	}, [ error, queryClient ] );
	return query;
}

// The account's sites no local site is connected to yet.
export function usePickableSites< Id extends SitesProviderId >(
	provider: Id,
	options: { enabled?: boolean } = {}
) {
	const connector = useConnector();
	const account = useAccountSites( provider, options );
	const providerConnected = useProviderConnected( provider );
	const connected = useQuery( {
		queryKey: remoteSitesQueryKey( provider ),
		queryFn: () => connector.getRemoteSites( provider ),
		enabled: ( options.enabled ?? true ) && !! providerConnected,
	} );

	const data = useMemo< ProviderSites[ Id ][] | undefined >( () => {
		if ( ! account.data ) {
			return undefined;
		}
		const connectedIds = new Set( ( connected.data ?? [] ).map( ( site ) => site.id ) );
		return account.data.filter( ( site ) => ! connectedIds.has( site.id ) );
	}, [ account.data, connected.data ] );

	return {
		data,
		isLoading: account.isLoading || connected.isLoading,
		isFetching: account.isFetching || connected.isFetching,
		error: account.error ?? connected.error,
		refetch: () => {
			void account.refetch();
			void connected.refetch();
		},
	};
}
