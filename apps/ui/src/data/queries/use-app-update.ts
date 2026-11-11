import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useRef, useState } from 'react';
import { clearToast, getVisibleToasts, toast } from '@/data/app-messages';
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
		onMutate: () => {
			clearToast( APP_UPDATE_NOTICE_ID );
			toast.processing( __( 'Checking for updates…' ), { id: APP_UPDATE_NOTICE_ID } );
		},
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
	const { mutateAsync: retry } = useRetryAppUpdate();
	const processing = useRef( false );
	// Repeated manual checks can have identical cached status.
	const [ manualCheckCount, setManualCheckCount ] = useState( 0 );
	useEffect( () => {
		return connector.onAppUpdateStatusChanged( ( status: AppUpdateStatus ) => {
			queryClient.setQueryData( APP_UPDATE_STATUS_QUERY_KEY, status );
			if ( status.requested ) setManualCheckCount( ( count ) => count + 1 );
		} );
	}, [ connector, queryClient ] );

	useEffect( () => {
		if ( ! status ) return;
		if ( status.requested ) clearToast( APP_UPDATE_NOTICE_ID );
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
			if (
				processing.current ||
				status.requested ||
				getVisibleToasts().some(
					( item ) => item.id === APP_UPDATE_NOTICE_ID && item.processing && ! item.leaving
				)
			) {
				processing.current = true;
				toast.processing( __( 'Checking for updates…' ), {
					id: APP_UPDATE_NOTICE_ID,
					dismissible: true,
				} );
			} else {
				clearToast( APP_UPDATE_NOTICE_ID );
			}
			return;
		}
		if ( status.state === 'ready' ) {
			if ( processing.current || status.requested ) {
				processing.current = false;
				toast.success( __( 'Update ready' ), {
					id: APP_UPDATE_NOTICE_ID,
					description: __( 'Restart WordPress Studio to finish updating.' ),
				} );
			} else {
				clearToast( APP_UPDATE_NOTICE_ID );
			}
			return;
		}
		if ( status.state === 'idle' ) {
			if ( processing.current ) {
				processing.current = false;
				clearToast( APP_UPDATE_NOTICE_ID );
			}
			return;
		}
		if ( status.state !== 'error' ) return;
		processing.current = false;
		toast.error( __( 'Couldn’t update Studio' ), {
			id: APP_UPDATE_NOTICE_ID,
			description: status.detail ?? __( 'Try downloading the update again.' ),
			action: { label: __( 'Try again' ), onClick: () => retry(), dismissOnSuccess: false },
		} );
	}, [ status, retry, manualCheckCount ] );

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
