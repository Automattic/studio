import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { dismissToast, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import type { AppUpdateStatus } from '@/data/core';

const APP_UPDATE_STATUS_QUERY_KEY = [ 'app-update-status' ] as const;
const APP_UPDATE_NOTICE_ID = 'app-update';

function describeVersionChange( currentVersion: string | null, newVersion: string | null ) {
	if ( currentVersion && newVersion ) {
		return sprintf(
			/* translators: 1: current version, e.g. "1.20.0". 2: new version, e.g. "1.21.0". */
			__( 'Updating from %1$s to %2$s.' ),
			currentVersion,
			newVersion
		);
	}
	if ( currentVersion ) {
		return sprintf(
			/* translators: %s: current version number, e.g. "1.20.0". */
			__( 'Updating from %s.' ),
			currentVersion
		);
	}
	return undefined;
}

export function useRetryAppUpdate() {
	const connector = useConnector();
	return useMutation( {
		mutationFn: () => connector.checkForAppUpdates(),
		onMutate: () => dismissToast( APP_UPDATE_NOTICE_ID ),
		onError: ( error ) =>
			toast.error( __( 'Couldn’t update Studio' ), {
				id: APP_UPDATE_NOTICE_ID,
				description: error.message,
			} ),
	} );
}

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
	const { mutate: retry } = useRetryAppUpdate();
	const processing = useRef( false );
	useEffect( () => {
		return connector.onAppUpdateStatusChanged( ( status: AppUpdateStatus ) => {
			queryClient.setQueryData( APP_UPDATE_STATUS_QUERY_KEY, status );
		} );
	}, [ connector, queryClient ] );

	useEffect( () => {
		if ( ! status ) return;
		if ( status.state === 'downloading' ) {
			processing.current = true;
			toast.processing( __( 'Downloading update' ), {
				id: APP_UPDATE_NOTICE_ID,
				dismissible: true,
				description: describeVersionChange( status.currentVersion, status.newVersion ),
			} );
			return;
		}
		if ( status.state === 'checking' ) {
			if ( processing.current ) {
				toast.processing( __( 'Checking for updates…' ), {
					id: APP_UPDATE_NOTICE_ID,
					dismissible: true,
				} );
			} else {
				dismissToast( APP_UPDATE_NOTICE_ID );
			}
			return;
		}
		if ( status.state === 'ready' ) {
			if ( processing.current ) {
				processing.current = false;
				toast.success( __( 'Update ready' ), {
					id: APP_UPDATE_NOTICE_ID,
					description: __( 'Restart Studio to finish updating.' ),
				} );
			} else {
				dismissToast( APP_UPDATE_NOTICE_ID );
			}
			return;
		}
		if ( status.state === 'idle' ) {
			if ( processing.current ) {
				processing.current = false;
				toast.info( __( 'Studio is up to date' ), { id: APP_UPDATE_NOTICE_ID } );
			}
			return;
		}
		if ( status.state !== 'error' ) return;
		processing.current = false;
		toast.error( __( 'Couldn’t update Studio' ), {
			id: APP_UPDATE_NOTICE_ID,
			description: status.detail ?? __( 'Try downloading the update again.' ),
			action: { label: __( 'Try again' ), onClick: () => retry() },
		} );
	}, [ status, retry ] );

	// A toast rather than a card: there's nothing to act on, so it shouldn't linger.
	useEffect( () => {
		return connector.onAppUpdateNotAvailable( ( { currentVersion } ) => {
			processing.current = false;
			toast.info(
				sprintf(
					/* translators: %s: current version number, e.g. "1.20.0". */
					__( "You're on the latest version (%s)" ),
					currentVersion
				),
				{ id: APP_UPDATE_NOTICE_ID }
			);
		} );
	}, [ connector ] );
}
