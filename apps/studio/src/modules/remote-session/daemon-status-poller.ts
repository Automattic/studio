import { getDaemonStatus, type DaemonStatus } from '@studio/common/lib/remote-session';
import { sendIpcEventToRenderer } from 'src/ipc-utils';

const DEFAULT_POLL_INTERVAL_MS = 5000;

export interface RemoteSessionStatusPollerOptions {
	intervalMs?: number;
	readStatus?: () => DaemonStatus;
	pushStatus?: ( status: DaemonStatus ) => void;
}

/**
 * Mirror the on-disk remote-session daemon state into Studio's renderer via a
 * lightweight main-process poll. The shape and disciplines mirror the CLI REPL's
 * `apps/cli/ai/daemon-status-poll.ts`:
 *
 * - Fires one synchronous tick before scheduling the interval so first paint
 *   doesn't wait 5s.
 * - Wraps each tick in try/catch — a transient `getDaemonStatus` read error
 *   must never crash the loop.
 * - Calls `timer.unref()` so the poller can't keep Electron alive during quit.
 * - Pushes to the renderer **only when `running` flips**. Identical states are
 *   silent — no renderer churn every 5s.
 *
 * The poller always runs because reading the PID file is cheap and the daemon
 * may already be running outside Studio (started from the CLI). The renderer
 * gates display on the `remoteSession` beta feature, so users who haven't
 * opted in never see the indicator even though status events still fire.
 *
 * The returned stop function clears the interval. It deliberately does NOT
 * touch the daemon itself — R9 of the brainstorm requires the daemon's
 * lifecycle to be independent from Studio's.
 */
export function startRemoteSessionStatusPolling(
	options: RemoteSessionStatusPollerOptions = {}
): () => void {
	const readStatus = options.readStatus ?? ( () => getDaemonStatus() );
	const pushStatus =
		options.pushStatus ??
		( ( status: DaemonStatus ) => {
			void sendIpcEventToRenderer( 'remote-session-status', status );
		} );

	let lastRunning: boolean | undefined;

	const tick = () => {
		try {
			const status = readStatus();
			if ( status.running !== lastRunning ) {
				lastRunning = status.running;
				pushStatus( status );
			}
		} catch {
			// Best-effort. A transient PID-file read error must not crash the loop.
		}
	};

	tick();
	const timer = setInterval( tick, options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS );
	if ( typeof timer.unref === 'function' ) {
		timer.unref();
	}

	return () => clearInterval( timer );
}
