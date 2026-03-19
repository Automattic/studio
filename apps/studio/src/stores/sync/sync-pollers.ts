/**
 * Shared poller abort controllers for sync push/pull operations.
 *
 * Extracted into its own module so both the poller loops (stores/index.ts)
 * and the cancel thunks (sync-operations-slice.ts) can abort in-flight
 * poll requests without circular imports.
 */

export const PUSH_POLLERS = new Map< string, AbortController >();
export const PULL_POLLERS = new Map< string, AbortController >();

export function stopPushPoller( stateId: string ) {
	PUSH_POLLERS.get( stateId )?.abort();
	PUSH_POLLERS.delete( stateId );
}

export function stopPullPoller( stateId: string ) {
	PULL_POLLERS.get( stateId )?.abort();
	PULL_POLLERS.delete( stateId );
}
