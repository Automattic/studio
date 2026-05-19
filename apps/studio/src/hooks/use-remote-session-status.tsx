import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { RemoteSessionStatus } from '@studio/common/lib/remote-session';

export interface UseRemoteSessionStatus {
	status: RemoteSessionStatus | undefined;
	/**
	 * `isRunning` is optimistic-aware: it flips immediately when the user invokes
	 * `start()`/`stop()` and reconciles after the post-call status refresh.
	 */
	isRunning: boolean;
	isLoading: boolean;
	start: () => Promise< void >;
	stop: () => Promise< void >;
}

function getErrorMessage( error: unknown ): string {
	if ( error instanceof Error ) {
		return error.message;
	}
	return String( error );
}

export function useRemoteSessionStatus(): UseRemoteSessionStatus {
	const [ status, setStatus ] = useState< RemoteSessionStatus >();
	const [ isLoading, setIsLoading ] = useState( false );
	const pendingRunningRef = useRef< boolean | null >( null );
	const isLoadingRef = useRef( false );

	const refreshStatus = useCallback( async () => {
		const latestStatus = await getIpcApi().getRemoteSessionDaemonStatus();
		setStatus( latestStatus );
		return latestStatus;
	}, [] );

	useEffect( () => {
		let isMounted = true;

		getIpcApi()
			.getRemoteSessionDaemonStatus()
			.then( ( latestStatus ) => {
				const pendingRunning = pendingRunningRef.current;
				if ( isMounted && ( pendingRunning === null || pendingRunning === latestStatus.running ) ) {
					setStatus( latestStatus );
				}
			} )
			.catch( () => undefined );

		return () => {
			isMounted = false;
		};
	}, [] );

	useIpcListener( 'remote-session-status', ( _event, incomingStatus ) => {
		const pendingRunning = pendingRunningRef.current;

		if ( pendingRunning !== null && pendingRunning !== incomingStatus.running ) {
			return;
		}

		setStatus( incomingStatus );
		if ( pendingRunning === incomingStatus.running ) {
			pendingRunningRef.current = null;
		}
	} );

	const runTransition = useCallback(
		async ( running: boolean, action: () => Promise< unknown >, errorTitle: string ) => {
			if ( isLoadingRef.current ) {
				return;
			}

			isLoadingRef.current = true;
			pendingRunningRef.current = running;
			setIsLoading( true );
			setStatus( { running } );

			try {
				await action();
			} catch ( error ) {
				void getIpcApi().showErrorMessageBox( {
					title: errorTitle,
					message: getErrorMessage( error ),
				} );
			} finally {
				try {
					await refreshStatus();
				} finally {
					pendingRunningRef.current = null;
					isLoadingRef.current = false;
					setIsLoading( false );
				}
			}
		},
		[ refreshStatus ]
	);

	const start = useCallback( async () => {
		await runTransition(
			true,
			() => getIpcApi().startRemoteSessionDaemon(),
			__( 'Failed to start remote session' )
		);
	}, [ runTransition ] );

	const stop = useCallback( async () => {
		await runTransition(
			false,
			() => getIpcApi().stopRemoteSessionDaemon(),
			__( 'Failed to stop remote session' )
		);
	}, [ runTransition ] );

	return { status, isRunning: status?.running === true, isLoading, start, stop };
}
