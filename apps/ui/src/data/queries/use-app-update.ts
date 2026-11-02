import { useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect } from 'react';
import { DISMISSED_MESSAGES_QUERY_KEY, openStudioLogsAction, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import type { AppUpdateStatus } from '@/data/core';

const APP_UPDATE_STATUS_QUERY_KEY = [ 'app-update-status' ] as const;

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
	const { data: status } = useAppUpdateStatus();
	useEffect( () => {
		return connector.onAppUpdateStatusChanged( ( status: AppUpdateStatus ) => {
			queryClient.setQueryData( APP_UPDATE_STATUS_QUERY_KEY, status );
			// The user explicitly asked, so an earlier dismissal shouldn't keep the card hidden.
			if ( status.requested ) {
				queryClient.setQueryData( DISMISSED_MESSAGES_QUERY_KEY, [] as string[] );
			}
		} );
	}, [ connector, queryClient ] );

	useEffect( () => {
		if ( status?.state !== 'error' ) return;
		toast.error( __( 'Couldn’t update Studio' ), {
			id: 'app-update-error',
			description: status.detail ?? __( 'We’ll try again the next time we check for updates.' ),
			action: openStudioLogsAction( connector ),
		} );
	}, [ status, connector ] );

	// A toast rather than a card: there's nothing to act on, so it shouldn't linger.
	useEffect( () => {
		return connector.onAppUpdateNotAvailable( ( { currentVersion } ) => {
			toast.info(
				sprintf(
					/* translators: %s: current version number, e.g. "1.20.0". */
					__( "You're on the latest version (%s)" ),
					currentVersion
				),
				{ id: 'app-update-not-available' }
			);
		} );
	}, [ connector ] );
}
