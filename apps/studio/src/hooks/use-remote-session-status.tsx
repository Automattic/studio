import { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
	selectRemoteSessionIsLoading,
	selectRemoteSessionIsRunning,
	selectRemoteSessionStatus,
	startRemoteSession,
	stopRemoteSession,
} from 'src/stores/remote-session-slice';
import type { RemoteSessionStatus } from '@studio/common/lib/remote-session';
import type { AppDispatch } from 'src/stores';

export interface UseRemoteSessionStatus {
	status: RemoteSessionStatus | undefined;
	/**
	 * `isRunning` is optimistic-aware: it flips immediately when the user
	 * invokes `start()`/`stop()` and stays that way until the daemon actually
	 * reaches the expected state (via the post-call refresh or a poll event).
	 * Use this for any UI gating; consult `status` for the last-known cached
	 * value (currently just `{ running }` — `pid` / `pidFile` stay on the
	 * main-process side).
	 */
	isRunning: boolean;
	isLoading: boolean;
	start: () => Promise< void >;
	stop: () => Promise< void >;
}

/**
 * Thin selector + dispatcher around `remote-session-slice`. The slice owns
 * the cache of the on-disk daemon status, the optimistic flip, and the
 * in-flight guard; all consumers (toolbar bolt + settings toggle) read from
 * the same store snapshot, so a flip on one is immediately visible to the
 * other.
 */
export function useRemoteSessionStatus(): UseRemoteSessionStatus {
	const dispatch = useDispatch< AppDispatch >();
	const status = useSelector( selectRemoteSessionStatus );
	const isRunning = useSelector( selectRemoteSessionIsRunning );
	const isLoading = useSelector( selectRemoteSessionIsLoading );

	const start = useCallback( async () => {
		await dispatch( startRemoteSession() );
	}, [ dispatch ] );

	const stop = useCallback( async () => {
		await dispatch( stopRemoteSession() );
	}, [ dispatch ] );

	return { status, isRunning, isLoading, start, stop };
}
