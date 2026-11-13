import { isSnapshotExpired } from '@studio/common/lib/snapshots';
import { getProviderSites, type SitesProviderId } from '@studio/providers';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConnector, type RemoteSiteConnection, type Snapshot } from '@/data/core';
import { useAiSettings } from '@/data/queries/use-ai-settings';
import { useAuthUser } from '@/data/queries/use-auth-user';
import {
	remoteSitesQueryKey,
	accountSitesQueryKey,
	publishTargetQueryKey,
	remotePublishTargetKey,
	usePublishProviders,
} from '@/data/queries/use-remote-sites';
import { useSnapshots } from '@/data/queries/use-snapshots';
import { getSnapshotName } from '@/data/snapshot-name';
import { getSnapshotHostname } from '@/data/snapshot-url';
import { getSyncActivity, getSyncActivityRunId, useSiteSyncActivity } from '@/data/sync-activity';
import { isNewDestination } from './new-destination';

export type PublishTarget = {
	key: string;
	label: string;
	provider: SitesProviderId;
	snapshot?: Snapshot;
	remote?: RemoteSiteConnection< SitesProviderId >;
};
export function usePublishTargets( siteId: string, open: boolean ) {
	const connector = useConnector();
	const client = useQueryClient();
	const providers = usePublishProviders();
	const user = useAuthUser();
	const accounts = useAiSettings();
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
		} ) ),
	} );
	const previewProvider = providers.find( ( id ) => getProviderSites( id ).previews );
	useEffect( () => {
		if ( snapshots.dataUpdatedAt && previewProvider ) {
			void client.invalidateQueries( { queryKey: remoteSitesQueryKey( previewProvider, siteId ) } );
		}
	}, [ client, previewProvider, siteId, snapshots.dataUpdatedAt ] );
	const previews = ( snapshots.data ?? [] )
		.filter( ( snapshot ) => snapshot.localSiteId === siteId && ! isSnapshotExpired( snapshot ) )
		.sort( ( a, b ) => b.date - a.date );
	const targets: PublishTarget[] = providers.flatMap( ( provider, index ) => {
		const descriptor = getProviderSites( provider );
		const stored = connections[ index ].data ?? [];
		const remotes = accountSites[ index ].data
			? descriptor.withDetails( stored, accountSites[ index ].data! )
			: stored;
		return remotes
			.filter(
				( remote ) =>
					! (
						! descriptor.previews?.isUpgraded( remote ) &&
						previews.some(
							( snapshot ) => descriptor.previews?.matchesSite( remote, snapshot.atomicSiteId )
						)
					)
			)
			.map( ( remote ) => ( {
				key: remotePublishTargetKey( provider, remote.id ),
				label: new URL( remote.url ).hostname,
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
								getProviderSites( target.provider ).previews?.matchesSite(
									target.remote,
									snapshot.atomicSiteId
								)
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
	const savedPreview = previews.find(
		( snapshot ) => `${ previewProvider }:preview:${ getSnapshotHostname( snapshot ) }` === saved
	);
	const selected =
		siteTargets.find( ( target ) => target.key === saved ) ??
		( savedPreview &&
			targets.find(
				( target ) =>
					target.remote &&
					getProviderSites( target.provider ).previews?.matchesSite(
						target.remote,
						savedPreview.atomicSiteId
					)
			) ) ??
		siteTargets[ 0 ] ??
		selectedPreview;
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
			queryKey: [ 'destination-changes', siteId, target.key ],
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
			enabled: activity?.kind !== 'pending',
			refetchInterval: 30_000,
			meta: { persist: false },
		} ) ),
	} );
	const selectedStatus =
		statuses[ targets.findIndex( ( target ) => target.key === selected?.key ) ];
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
		select: ( target: PublishTarget ) =>
			client.setQueryData( target.snapshot ? previewKey : key, target.key ),
		selectPreview: ( hostname: string ) =>
			client.setQueryData( previewKey, `${ previewProvider }:preview:${ hostname }` ),
		refresh: () => {
			connections.forEach( ( query ) => void query.refetch() );
			if ( user.data ) void snapshots.refetch();
			accountSites.forEach( ( query, index ) => {
				if ( accounts.data?.accounts[ providers[ index ] ].connected ) void query.refetch();
			} );
		},
	};
}
