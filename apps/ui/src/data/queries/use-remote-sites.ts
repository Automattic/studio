import {
	getProviderSites,
	SITES_PROVIDER_IDS,
	type ProviderSites,
	type SitesProviderId,
} from '@studio/providers';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useConnector } from '@/data/core';
import { AI_SETTINGS_QUERY_KEY, useAiSettings } from '@/data/queries/use-ai-settings';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	ACCOUNT_SITES_QUERY_KEY,
	REMOTE_SITES_QUERY_KEY,
} from '@/data/queries/user-scoped-query-keys';
import type { Connector, RemoteSiteConnection } from '@/data/core';

export const remoteSitesQueryKey = ( provider: SitesProviderId, localSiteId?: string ) =>
	[ ...REMOTE_SITES_QUERY_KEY, provider, localSiteId ?? null ] as const;

export const accountSitesQueryKey = ( provider: SitesProviderId ) =>
	[ ...ACCOUNT_SITES_QUERY_KEY, provider ] as const;

export const publishTargetQueryKey = ( siteId: string ) => [ 'publish-target', siteId ] as const;

export const remotePublishTargetKey = ( provider: SitesProviderId, id: string | number ) =>
	`${ provider }:site:${ id }`;

function accountSitesQuery< Id extends SitesProviderId >( connector: Connector, provider: Id ) {
	return {
		queryKey: accountSitesQueryKey( provider ),
		queryFn: async () => ( await connector.listAccountSites( provider ) ) as ProviderSites[ Id ][],
		staleTime: 5 * 60 * 1000,
	};
}

function allRemoteConnectionsQuery( connector: Connector, provider: SitesProviderId ) {
	return {
		queryKey: remoteSitesQueryKey( provider ),
		queryFn: () => connector.getRemoteSites( provider ),
	};
}

function excludeConnectedSites< Site extends ProviderSites[ SitesProviderId ] >(
	sites: Site[] | undefined,
	connections: RemoteSiteConnection< SitesProviderId >[] | undefined
) {
	if ( ! sites ) return undefined;
	const connectedIds = new Set( ( connections ?? [] ).map( ( site ) => site.id ) );
	return sites.filter( ( site ) => ! connectedIds.has( site.id ) );
}

// The providers this app publishes to: one that publishes a static export needs the site to run
// on native PHP.
export function usePublishProviders(): SitesProviderId[] {
	const { capabilities } = useConnector();
	return SITES_PROVIDER_IDS.filter(
		( id ) => capabilities.nativeSites || getProviderSites( id ).content !== 'static'
	);
}

export function useConnectedHostingProviders( providers: SitesProviderId[] ) {
	const auth = useAuthUser();
	const settings = useAiSettings();
	return {
		connected: providers.filter( ( id ) =>
			id === 'wpcom' ? !! auth.data : settings.data?.accounts[ id ].connected
		),
		isPending: providers.some( ( id ) => ( id === 'wpcom' ? auth.isPending : settings.isPending ) ),
	};
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
		...accountSitesQuery( connector, provider ),
		enabled: ( options.enabled ?? true ) && !! connected,
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
		...allRemoteConnectionsQuery( connector, provider ),
		enabled: ( options.enabled ?? true ) && !! providerConnected,
	} );

	const data = useMemo(
		() => excludeConnectedSites( account.data, connected.data ),
		[ account.data, connected.data ]
	);

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

export function usePickableSitesByProvider( providers: SitesProviderId[] ) {
	const connector = useConnector();
	const client = useQueryClient();
	const accounts = useQueries( {
		queries: providers.map( ( provider ) => accountSitesQuery( connector, provider ) ),
	} );
	const connections = useQueries( {
		queries: providers.map( ( provider ) => allRemoteConnectionsQuery( connector, provider ) ),
	} );
	const latestAccountError = Math.max(
		0,
		...accounts.map( ( account ) => account.errorUpdatedAt )
	);
	useEffect( () => {
		if ( latestAccountError ) void client.invalidateQueries( { queryKey: AI_SETTINGS_QUERY_KEY } );
	}, [ client, latestAccountError ] );

	return providers.map( ( provider, index ) => {
		const account = accounts[ index ];
		const connected = connections[ index ];
		return {
			provider,
			data:
				account.isSuccess && connected.isSuccess
					? excludeConnectedSites( account.data, connected.data ) ?? []
					: [],
			isLoading: account.isLoading || connected.isLoading,
			isFetching: account.isFetching || connected.isFetching,
			error: account.error ?? connected.error,
			refetch: () => {
				void account.refetch();
				void connected.refetch();
			},
		};
	} );
}
