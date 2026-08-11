import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useConnector } from '@/data/core';
import { SITES_QUERY_KEY } from './use-sites';

export const checkpointsQueryKey = ( siteId: string ) => [ 'site-checkpoints', siteId ] as const;

export function useCheckpoints( siteId: string | undefined ) {
	const connector = useConnector();
	return useQuery( {
		queryKey: checkpointsQueryKey( siteId ?? '' ),
		queryFn: () => connector.listCheckpoints( siteId! ),
		enabled: !! siteId && ( connector.capabilities?.siteCheckpoints ?? false ),
	} );
}

export interface CreateCheckpointInput {
	siteId: string;
	label?: string;
}

export function useCreateCheckpoint() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { siteId, label }: CreateCheckpointInput ) =>
			connector.createCheckpoint( siteId, label ),
		onSuccess: ( _data, { siteId } ) =>
			queryClient.invalidateQueries( { queryKey: checkpointsQueryKey( siteId ) } ),
	} );
}

export interface RestoreCheckpointInput {
	siteId: string;
	checkpointId: string;
}

/**
 * Restores a site to a checkpoint (files + database). The engine captures a
 * safety checkpoint of the current state first, so the list is invalidated to
 * pick it up — and the site list too, since restore stops/starts the server
 * and may change the site's PHP/WordPress versions.
 */
export function useRestoreCheckpoint() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { siteId, checkpointId }: RestoreCheckpointInput ) =>
			connector.restoreCheckpoint( siteId, checkpointId ),
		onSuccess: ( _data, { siteId } ) => {
			void queryClient.invalidateQueries( { queryKey: checkpointsQueryKey( siteId ) } );
			void queryClient.invalidateQueries( { queryKey: SITES_QUERY_KEY } );
		},
	} );
}

export interface DeleteCheckpointInput {
	siteId: string;
	checkpointId: string;
}

export function useDeleteCheckpoint() {
	const connector = useConnector();
	const queryClient = useQueryClient();
	return useMutation( {
		mutationFn: ( { siteId, checkpointId }: DeleteCheckpointInput ) =>
			connector.deleteCheckpoint( siteId, checkpointId ),
		onSuccess: ( _data, { siteId } ) =>
			queryClient.invalidateQueries( { queryKey: checkpointsQueryKey( siteId ) } ),
	} );
}
