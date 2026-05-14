import { __ } from '@wordpress/i18n';
import { useEffect, useReducer } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { DaemonStatus } from '@studio/common/lib/remote-session';

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
 * Module-level shared state.
 *
 * Every component that calls `useRemoteSessionStatus` reads from the same
 * snapshot, so an optimistic flip from one consumer (e.g. the settings
 * toggle) is immediately visible to every other consumer (e.g. the top-bar
 * indicator). Without this, each hook instance kept its own local state and
 * the indicator only caught up after the main-process daemon-status poll
 * (up to ~5s of lag).
 */
const sharedState: {
	status: DaemonStatus | undefined;
	optimisticRunning: boolean | null;
	isLoading: boolean;
	inFlight: boolean;
	initialFetch: Promise< void > | null;
} = {
	status: undefined,
	optimisticRunning: null,
	isLoading: false,
	inFlight: false,
	initialFetch: null,
};

const listeners = new Set< () => void >();

function notify(): void {
	listeners.forEach( ( l ) => l() );
}

async function refreshStatus(): Promise< void > {
	try {
		const current = await getIpcApi().getRemoteSessionDaemonStatus();
		sharedState.status = current;
		sharedState.optimisticRunning = null;
		notify();
	} catch ( error ) {
		console.error( 'Failed to read remote-session status', error );
	}
}

function ensureInitialFetch(): Promise< void > {
	if ( ! sharedState.initialFetch ) {
		sharedState.initialFetch = refreshStatus();
	}
	return sharedState.initialFetch;
}

async function startDaemon(): Promise< void > {
	if ( sharedState.inFlight ) {
		return;
	}
	sharedState.inFlight = true;
	sharedState.optimisticRunning = true;
	sharedState.isLoading = true;
	notify();
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
		sharedState.inFlight = false;
		sharedState.isLoading = false;
		notify();
	}
}

async function stopDaemon(): Promise< void > {
	if ( sharedState.inFlight ) {
		return;
	}
	sharedState.inFlight = true;
	sharedState.optimisticRunning = false;
	sharedState.isLoading = true;
	notify();
	try {
		await getIpcApi().stopRemoteSessionDaemon();
	} catch ( error ) {
		void getIpcApi().showErrorMessageBox( {
			title: __( 'Failed to stop remote session' ),
			message: getErrorMessage( error ),
		} );
	} finally {
		await refreshStatus();
		sharedState.inFlight = false;
		sharedState.isLoading = false;
		notify();
	}
}

function applyIncomingStatus( incoming: DaemonStatus ): void {
	sharedState.status = incoming;
	// Reconcile only if the poll confirms the optimistic guess; otherwise
	// keep showing the user's intent until the in-flight call returns.
	if (
		sharedState.optimisticRunning !== null &&
		sharedState.optimisticRunning === incoming.running
	) {
		sharedState.optimisticRunning = null;
	}
	notify();
}

/**
 * Reset all module-level state. Test-only entry point so the shared store
 * doesn't bleed between cases.
 */
export function _resetRemoteSessionStatusStateForTests(): void {
	sharedState.status = undefined;
	sharedState.optimisticRunning = null;
	sharedState.isLoading = false;
	sharedState.inFlight = false;
	sharedState.initialFetch = null;
	listeners.clear();
}

/**
 * Reflects the remote-session daemon's state in the renderer.
 *
 * Combines a one-shot IPC fetch on mount with a long-lived
 * `remote-session-status` subscription. State is shared across hook
 * instances via module-level globals so an optimistic flip propagates to
 * every consumer on the same React tick.
 *
 * `start`/`stop` invoke their IPC counterparts. Failures surface via the
 * existing `showErrorMessageBox` dialog (Studio has no toast surface
 * today). While a call is in flight, `isRunning` is flipped optimistically
 * so the indicator and the settings toggle reflect the user's intent
 * immediately. Real state is reconciled by `refreshStatus` after the call
 * completes; on error, the optimistic value is overwritten by the actual
 * daemon state.
 */
export function useRemoteSessionStatus(): UseRemoteSessionStatus {
	const [ , forceUpdate ] = useReducer( ( x: number ) => x + 1, 0 );

	useEffect( () => {
		listeners.add( forceUpdate );
		return () => {
			listeners.delete( forceUpdate );
		};
	}, [ forceUpdate ] );

	useEffect( () => {
		void ensureInitialFetch();
	}, [] );

	useIpcListener( 'remote-session-status', ( _event, incoming ) => {
		applyIncomingStatus( incoming );
	} );

	const isRunning = sharedState.optimisticRunning ?? sharedState.status?.running === true;

	return {
		status: sharedState.status,
		isRunning,
		isLoading: sharedState.isLoading,
		start: startDaemon,
		stop: stopDaemon,
	};
}
