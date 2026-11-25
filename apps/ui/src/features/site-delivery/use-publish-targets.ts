import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { getProviderSites, type SitesProviderId } from '@studio/providers';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConnector, type RemoteSiteConnection, type Snapshot } from '@/data/core';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useAuthUser } from '@/data/queries/use-auth-user';
import { previewStatusQuery } from '@/data/queries/use-preview-status';
import {
	remoteSitesQueryKey,
	accountSitesQueryKey,
	publishTargetQueryKey,
	remotePublishTargetKey,
	useConnectedHostingProviders,
	useSitesProviders,
} from '@/data/queries/use-remote-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { SNAPSHOTS_QUERY_KEY } from '@/data/queries/user-scoped-query-keys';
import { getSnapshotName } from '@/data/snapshot-name';
import { getSnapshotHostname } from '@/data/snapshot-url';
import { getSyncActivity, getSyncActivityRunId, useSiteSyncActivity } from '@/data/sync-activity';
import { isNewDestination } from './new-destination';

const UNCONNECTED_TARGET = 'unconnected';

export type PublishTarget = {
	key: string;
	label: string;
	provider: SitesProviderId;
	snapshot?: Snapshot;
	remote?: RemoteSiteConnection< SitesProviderId >;
};
export function usePublishTargets(
	siteId: string,
	open: boolean,
	targetKey?: string,
	previewSiteId?: number
) {
	const connector = useConnector();
	const client = useQueryClient();
	const providers = useSitesProviders( 'publish' );
	const user = useAuthUser();
	const accounts = useAiSettings();
	const connectedProviders = useConnectedHostingProviders( providers ).connected;
	const snapshots = useSnapshots( user.data?.id );
	const activity = useSiteSyncActivity( siteId );
	const connections = useQueries( {
		queries: providers.map( ( provider ) => ( {
			queryKey: remoteSitesQueryKey( provider, siteId ),
			queryFn: () => connector.getRemoteSites( provider, siteId ),
		} ) ),
	} );
	const accountSites = useQueries( {
		queries: providers.map( ( provider ) => ( {
			queryKey: accountSitesQueryKey( provider ),
			queryFn: () => connector.listAccountSites( provider ),
			enabled: open && !! accounts.data?.accounts[ provider ].connected,
			staleTime: 30_000,
			refetchOnWindowFocus: 'always' as const,
		} ) ),
	} );
	const previewProvider = providers.find( ( id ) => getProviderSites( id ).previews );
	useEffect( () => {
		if ( snapshots.dataUpdatedAt && previewProvider ) {
			void client.invalidateQueries( { queryKey: remoteSitesQueryKey( previewProvider, siteId ) } );
			void client.invalidateQueries( { queryKey: accountSitesQueryKey( previewProvider ) } );
		}
	}, [ client, previewProvider, siteId, snapshots.dataUpdatedAt ] );
	useEffect( () => {
		if ( ! open ) return;
		const refresh = () => {
			void client.invalidateQueries( { queryKey: SNAPSHOTS_QUERY_KEY } );
			for ( const provider of providers ) {
				void client.invalidateQueries( { queryKey: remoteSitesQueryKey( provider, siteId ) } );
				void client.invalidateQueries( { queryKey: accountSitesQueryKey( provider ) } );
			}
		};
		window.addEventListener( 'focus', refresh );
		return () => window.removeEventListener( 'focus', refresh );
	}, [ client, open, providers, siteId ] );
	const previews = ( snapshots.data ?? [] )
		.filter( ( snapshot ) => snapshot.localSiteId === siteId && ! isSnapshotExpired( snapshot ) )
		.sort( ( a, b ) => b.date - a.date );
	const targets: PublishTarget[] = providers.flatMap( ( provider, index ) => {
		const descriptor = getProviderSites( provider );
		const stored = connections[ index ].data ?? [];
		const account = accountSites[ index ].data;
		const remotes = ( account && descriptor.withDetails?.( stored, account ) ) || stored;
		return remotes
			.filter(
				( remote ) =>
					! (
						! descriptor.previews?.isUpgraded?.( remote ) &&
						previews.some(
							( snapshot ) => provider === previewProvider && remote.id === snapshot.atomicSiteId
						)
					)
			)
			.map( ( remote ) => ( {
				key: remotePublishTargetKey( provider, remote.id ),
				label: remote.name?.trim() || new URL( remote.url ).hostname,
				provider,
				remote,
			} ) );
	} );
	if ( previewProvider )
		targets.push(
			...previews
				.filter(
					( snapshot ) =>
						! targets.some(
							( target ) =>
								target.remote &&
								target.provider === previewProvider &&
								target.remote.id === snapshot.atomicSiteId
						)
				)
				.map( ( snapshot ) => ( {
					key: `${ previewProvider }:preview:${ getSnapshotHostname( snapshot ) }`,
					label: getSnapshotName( snapshot, snapshots.data ),
					provider: previewProvider,
					snapshot,
				} ) )
		);
	const key = publishTargetQueryKey( siteId );
	const saved = useQuery( {
		queryKey: key,
		queryFn: () => null as string | null,
		initialData: null as string | null,
		staleTime: Infinity,
	} ).data;
	const previewKey = [ 'publish-preview-target', siteId ];
	const savedPreviewKey = useQuery( {
		queryKey: previewKey,
		queryFn: () => null as string | null,
		initialData: null as string | null,
		staleTime: Infinity,
	} ).data;
	const siteTargets = targets.filter( ( target ) => target.remote );
	const previewTargets = targets.filter( ( target ) => target.snapshot );
	const selectedPreview =
		previewTargets.find( ( target ) => target.key === savedPreviewKey ) ??
		previewTargets.find( ( target ) => target.key === saved ) ??
		previewTargets[ 0 ];
	const findTarget = ( key: string | null ) => {
		const savedPreview = previews.find(
			( snapshot ) => `${ previewProvider }:preview:${ getSnapshotHostname( snapshot ) }` === key
		);
		const atomicSiteId = savedPreview?.atomicSiteId ?? previewSiteId;
		return (
			targets.find( ( target ) => target.key === key ) ??
			targets.find(
				( target ) =>
					atomicSiteId !== undefined &&
					target.provider === previewProvider &&
					( target.snapshot?.atomicSiteId === atomicSiteId || target.remote?.id === atomicSiteId )
			)
		);
	};
	const selected = targetKey
		? findTarget( targetKey )
		: findTarget( saved ) ??
		  siteTargets[ 0 ] ??
		  ( saved === UNCONNECTED_TARGET ? undefined : selectedPreview );
	const versions = JSON.stringify(
		targets.map( ( target ) => [
			target.key,
			target.remote?.localVersionId,
			target.remote?.lastPushTimestamp,
			target.remote?.lastPullTimestamp,
			target.snapshot?.versionId,
			target.snapshot?.syncedAt,
			target.snapshot?.date,
		] )
	);
	useEffect( () => {
		void client.invalidateQueries( { queryKey: [ 'destination-changes', siteId ] } );
	}, [ client, siteId, versions ] );
	const statuses = useQueries( {
		queries: targets.map( ( target ) => ( {
			queryKey: target.snapshot
				? previewStatusQuery( connector, target.snapshot ).queryKey
				: [ 'destination-changes', siteId, target.key ],
			queryFn: async () => {
				const checkedRunId =
					getSyncActivity( siteId )?.kind === 'pending'
						? undefined
						: getSyncActivityRunId( siteId );
				const result = target.snapshot
					? await connector.getPreviewStatus( getSnapshotHostname( target.snapshot ) )
					: await connector.getSitePublishStatus( siteId, target.remote!.id, target.provider );
				return { ...result, checkedRunId };
			},
			enabled:
				connectedProviders.includes( target.provider ) &&
				activity?.kind !== 'pending' &&
				( open || target.key === selected?.key ),
			// The selected preview's usePreviewStatus observer owns its polling interval.
			refetchInterval: target.snapshot ? false : 30_000,
			meta: { persist: false },
		} ) ),
	} );
	const selectedStatus =
		statuses[ targets.findIndex( ( target ) => target.key === selected?.key ) ];
	const selectedAccount = selected && accountSites[ providers.indexOf( selected.provider ) ];
	const previewAccountSite =
		selected?.snapshot &&
		selectedAccount?.data?.find( ( site ) => site.id === selected.snapshot!.atomicSiteId );
	const selectedConnection =
		selected?.remote && connections[ providers.indexOf( selected.provider ) ];
	const confirmingPublish =
		!! selected?.remote &&
		activity?.kind === 'success' &&
		activity.direction === 'push' &&
		activity.provider === selected.provider &&
		activity.remoteSiteId === selected.remote.id &&
		( selectedConnection?.isFetching ||
			( ! selectedStatus?.isError &&
				selectedStatus?.data?.checkedRunId !== getSyncActivityRunId( siteId ) ) );
	return {
		confirmingPublish,
		previewAccountSite,
		selectedAccount,
		findTarget,
		loadingTargets:
			user.isPending ||
			connections.some( ( query ) => query.isPending ) ||
			( !! user.data && snapshots.isPending ),
		unavailableProviders: providers.filter(
			( _, index ) =>
				connections[ index ].isError ||
				( connections[ index ].data === undefined && connections[ index ].errorUpdatedAt > 0 )
		),
		previewsUnavailable:
			!! user.data &&
			( snapshots.isError || ( snapshots.data === undefined && snapshots.errorUpdatedAt > 0 ) ),
		refreshingTargets:
			connections.some(
				( query, index ) =>
					query.isFetching ||
					( providers[ index ] === previewProvider &&
						Math.max( query.dataUpdatedAt, query.errorUpdatedAt ) < snapshots.dataUpdatedAt )
			) ||
			( !! user.data && snapshots.isFetching ),
		retryUnavailable: () => {
			connections.forEach( ( query ) => {
				if ( query.isError ) void query.refetch();
			} );
			if ( snapshots.isError && user.data ) void snapshots.refetch();
		},
		loadingConnections: connections.some( ( query ) => query.isPending ),
		connectionState: ( provider: SitesProviderId ) => {
			const query = connections[ providers.indexOf( provider ) ];
			return {
				loading: query.isPending,
				unavailable: query.data === undefined && ( query.isError || query.errorUpdatedAt > 0 ),
				refreshing: query.isFetching,
				retry: () => void query.refetch(),
			};
		},
		providers,
		previewProvider,
		targets,
		siteTargets,
		previewTargets,
		selectedPreview,
		selected,
		selectedStatus,
		hasChanges: ( target: PublishTarget ) =>
			isNewDestination( target.remote ) ||
			statuses[ targets.indexOf( target ) ]?.data?.localChanged === true,
		select: ( target: PublishTarget | null ) => {
			client.setQueryData( key, target?.key ?? UNCONNECTED_TARGET );
			if ( target?.snapshot ) client.setQueryData( previewKey, target.key );
		},
		selectPreview: ( hostname: string ) => {
			const prefix = `${ previewProvider }:preview:`;
			const targetKey = `${ prefix }${ hostname }`;
			client.setQueryData( previewKey, targetKey );
			client.setQueryData< string | null >( key, ( current ) =>
				current === UNCONNECTED_TARGET || current?.startsWith( prefix ) ? targetKey : current
			);
		},
		refresh: () => {
			connections.forEach( ( query ) => void query.refetch() );
			if ( user.data ) void snapshots.refetch();
			accountSites.forEach( ( query, index ) => {
				if ( accounts.data?.accounts[ providers[ index ] ].connected ) void query.refetch();
			} );
		},
	};
}
