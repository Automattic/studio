import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { RemoteSessionStatus } from '@studio/common/lib/remote-session';
import type { IpcRendererEvent } from 'electron';

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
	const isMountedRef = useRef( false );

	const setStatusIfMounted = useCallback( ( nextStatus: RemoteSessionStatus ) => {
		if ( isMountedRef.current ) {
			setStatus( nextStatus );
		}
	}, [] );

	const setIsLoadingIfMounted = useCallback( ( nextIsLoading: boolean ) => {
		if ( isMountedRef.current ) {
			setIsLoading( nextIsLoading );
		}
	}, [] );

	const refreshStatus = useCallback( async () => {
		const latestStatus = await getIpcApi().getRemoteSessionDaemonStatus();
		setStatusIfMounted( latestStatus );
		return latestStatus;
	}, [ setStatusIfMounted ] );

	useEffect( () => {
		isMountedRef.current = true;
		let isCurrentRequest = true;

		getIpcApi()
			.getRemoteSessionDaemonStatus()
			.then( ( latestStatus ) => {
				const pendingRunning = pendingRunningRef.current;
				if (
					isCurrentRequest &&
					( pendingRunning === null || pendingRunning === latestStatus.running )
				) {
					setStatusIfMounted( latestStatus );
				}
			} )
			.catch( () => undefined );

		return () => {
			isCurrentRequest = false;
			isMountedRef.current = false;
		};
	}, [ setStatusIfMounted ] );

	const handleRemoteSessionStatus = useCallback(
		( _event: IpcRendererEvent, incomingStatus: RemoteSessionStatus ) => {
			if ( ! isMountedRef.current ) {
				return;
			}

			const pendingRunning = pendingRunningRef.current;

			if ( pendingRunning !== null && pendingRunning !== incomingStatus.running ) {
				return;
			}

			setStatus( incomingStatus );
			if ( pendingRunning === incomingStatus.running ) {
				pendingRunningRef.current = null;
			}
		},
		[]
	);

	useIpcListener( 'remote-session-status', handleRemoteSessionStatus );

	const finishTransition = useCallback( async () => {
		await refreshStatus().finally( () => {
			pendingRunningRef.current = null;
			isLoadingRef.current = false;
			setIsLoadingIfMounted( false );
		} );
	}, [ refreshStatus, setIsLoadingIfMounted ] );

	const runTransition = useCallback(
		async ( running: boolean, action: () => Promise< unknown >, errorTitle: string ) => {
			if ( isLoadingRef.current ) {
				return;
			}

			isLoadingRef.current = true;
			pendingRunningRef.current = running;
			setIsLoadingIfMounted( true );
			setStatusIfMounted( { running } );

			try {
				await action();
			} catch ( error ) {
				void getIpcApi().showErrorMessageBox( {
					title: errorTitle,
					message: getErrorMessage( error ),
				} );
			} finally {
				await finishTransition();
			}
		},
		[ finishTransition, setIsLoadingIfMounted, setStatusIfMounted ]
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
