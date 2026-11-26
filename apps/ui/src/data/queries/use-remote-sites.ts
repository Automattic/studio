import {
	getProvider,
	getProviderSites,
	SITES_PROVIDER_IDS,
	type ProviderSites,
	type SitesProviderId,
} from '@studio/providers';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import { AI_SETTINGS_QUERY_KEY, useAiSettings } from '@/data/queries/use-ai-settings';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	ACCOUNT_SITES_QUERY_KEY,
	REMOTE_SITES_QUERY_KEY,
} from '@/data/queries/user-scoped-query-keys';
import type { Connector, RemoteSiteConnection } from '@/data/core';
import type { AiSettings } from '@studio/common/lib/ai-settings';

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

// The providers this app publishes to or pulls from, leaving out those whose sites only the user's
// computer connects when this app runs elsewhere.
export function useSitesProviders( use: 'publish' | 'pull' ): SitesProviderId[] {
	const { localMachine } = useConnector().capabilities;
	return SITES_PROVIDER_IDS.filter( ( id ) => {
		const sites = getProviderSites( id );
		return ( use === 'publish' || sites.pull ) && ( localMachine || ! sites.connect?.hostOnly );
	} );
}

// Whether the provider's account is connected: WordPress.com's is the Studio sign-in, and a
// provider without an account has nothing to connect. Undefined while that isn't known yet.
function isConnected(
	provider: SitesProviderId,
	signedIn: boolean | undefined,
	settings: AiSettings | undefined
): boolean | undefined {
	if ( ! getProvider( provider ).account ) {
		return true;
	}
	return provider === 'wpcom' ? signedIn : settings?.accounts[ provider ].connected;
}

export function useConnectedHostingProviders( providers: SitesProviderId[] ) {
	const auth = useAuthUser();
	const settings = useAiSettings();
	return {
		connected: providers.filter( ( id ) => isConnected( id, !! auth.data, settings.data ) ),
		isPending: providers.some( ( id ) => ( id === 'wpcom' ? auth.isPending : settings.isPending ) ),
	};
}

function useProviderConnected( provider: SitesProviderId ): boolean | undefined {
	const { data: authUser, isSuccess } = useAuthUser();
	const settings = useAiSettings();
	return isConnected( provider, isSuccess ? !! authUser : undefined, settings.data );
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
