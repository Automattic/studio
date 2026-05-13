import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { DaemonStatus } from 'cli/remote-session/daemon';

export interface UseRemoteSessionStatus {
	status: DaemonStatus | undefined;
	/**
	 * `isRunning` is optimistic-aware: it flips immediately when the user
	 * invokes `start()`/`stop()` and stays that way until the daemon actually
	 * reaches the expected state (via `refreshStatus` or a poll event). Use
	 * this for any UI gating; consult `status` only when the underlying
	 * `pid`/`pidFile` matters.
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

/**
 * Reflects the remote-session daemon's state in the renderer.
 *
 * Combines a one-shot IPC fetch on mount with a long-lived `remote-session-status`
 * subscription. The fetch covers the "what was the state when this component
 * mounted?" case for components that mount after the main-process poller has
 * already pushed its initial tick.
 *
 * `start`/`stop` invoke their IPC counterparts. Failures surface via the existing
 * `showErrorMessageBox` dialog (Studio has no toast surface today). While a call
 * is in flight, `isRunning` is flipped optimistically so the indicator and the
 * settings toggle reflect the user's intent immediately. Real state is reconciled
 * by `refreshStatus` after the call completes; on error, the optimistic value is
 * overwritten by the actual daemon state.
 */
export function useRemoteSessionStatus(): UseRemoteSessionStatus {
	const [ status, setStatus ] = useState< DaemonStatus | undefined >( undefined );
	const [ optimisticRunning, setOptimisticRunning ] = useState< boolean | null >( null );
	const [ isLoading, setIsLoading ] = useState( false );
	// A ref tracks in-flight state synchronously so two clicks within the same
	// React tick can't both pass the `isLoading` gate — the second one would
	// otherwise read a stale closure value before the re-render flushes.
	const inFlightRef = useRef( false );

	const refreshStatus = useCallback( async () => {
		try {
			const current = await getIpcApi().getRemoteSessionDaemonStatus();
			setStatus( current );
			setOptimisticRunning( null );
		} catch ( error ) {
			console.error( 'Failed to read remote-session status', error );
		}
	}, [] );

	useEffect( () => {
		void refreshStatus();
	}, [ refreshStatus ] );

	useIpcListener( 'remote-session-status', ( _event, incoming ) => {
		setStatus( incoming );
		// Reconcile only if the poll confirms the optimistic guess; otherwise
		// keep showing the user's intent until the in-flight call returns.
		setOptimisticRunning( ( prev ) =>
			prev === null || prev === incoming.running ? null : prev
		);
	} );

	const start = useCallback( async () => {
		if ( inFlightRef.current ) {
			return;
		}
		inFlightRef.current = true;
		setOptimisticRunning( true );
		setIsLoading( true );
		try {
			await getIpcApi().startRemoteSessionDaemon();
		} catch ( error ) {
			void getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to start remote session' ),
				message: getErrorMessage( error ),
			} );
		} finally {
			// Re-fetch on completion (success OR error) so the indicator
			// reflects reality immediately rather than waiting up to one
			// poll interval. Especially important when start errors with
			// "already running" — the daemon IS up, and the user shouldn't
			// have to wait for the next tick to see that.
			await refreshStatus();
			inFlightRef.current = false;
			setIsLoading( false );
		}
	}, [ refreshStatus ] );

	const stop = useCallback( async () => {
		if ( inFlightRef.current ) {
			return;
		}
		inFlightRef.current = true;
		setOptimisticRunning( false );
		setIsLoading( true );
		try {
			await getIpcApi().stopRemoteSessionDaemon();
		} catch ( error ) {
			void getIpcApi().showErrorMessageBox( {
				title: __( 'Failed to stop remote session' ),
				message: getErrorMessage( error ),
			} );
		} finally {
			await refreshStatus();
			inFlightRef.current = false;
			setIsLoading( false );
		}
	}, [ refreshStatus ] );

	const isRunning = optimisticRunning ?? status?.running === true;

	return { status, isRunning, isLoading, start, stop };
}
