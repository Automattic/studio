import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import type { AppUpdateStatus } from '@/data/core';

export const APP_UPDATE_STATUS_QUERY_KEY = [ 'app-update-status' ] as const;

export function useAppUpdateStatus() {
	const connector = useConnector();
	return useQuery( {
		queryKey: APP_UPDATE_STATUS_QUERY_KEY,
		queryFn: () => connector.getAppUpdateStatus(),
		staleTime: Infinity,
		meta: { persist: false },
	} );
}

/**
 * Mirrors main-process update events into the query cache. Mount once near
 * the app root; combined with the mount-time query it covers downloads that
 * finished before the window existed.
 */
export function useSyncAppUpdateStatus(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();
	useEffect( () => {
		return connector.onAppUpdateStatusChanged( ( status: AppUpdateStatus ) => {
			queryClient.setQueryData( APP_UPDATE_STATUS_QUERY_KEY, status );
		} );
	}, [ connector, queryClient ] );
}

export function useInstallAppUpdate() {
	const connector = useConnector();
	return useMutation( {
		mutationFn: () => connector.installAppUpdate(),
	} );
}
