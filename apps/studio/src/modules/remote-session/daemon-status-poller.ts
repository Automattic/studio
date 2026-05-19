import {
	getDaemonStatus,
	pollDaemonStatus,
	toRemoteSessionStatus,
	type DaemonStatus,
} from '@studio/common/lib/remote-session';
import { sendIpcEventToRenderer } from 'src/ipc-utils';

export interface RemoteSessionStatusPollerOptions {
	intervalMs?: number;
	readStatus?: () => DaemonStatus;
	pushStatus?: ( status: DaemonStatus ) => void;
}

/**
 * Mirror the on-disk remote-session daemon state into Studio's renderer via a
 * lightweight main-process poll. The polling skeleton (sync first tick,
 * try/catch per read, `timer.unref()`) lives in `@studio/common/lib/remote-session`
 * and is shared with the CLI REPL's bottom-bar indicator; this wrapper just
 * supplies the renderer-facing sink and a transition-dedupe filter so the
 * renderer doesn't churn every 5 seconds on identical states.
 *
 * The poller always runs — reading the PID file is cheap and the daemon may
 * already be running outside Studio (started from the CLI). The renderer
 * gates display on the `remoteSession` beta feature, so users who haven't
 * opted in never see the indicator even though status events still fire.
 */
export function startRemoteSessionStatusPolling(
	options: RemoteSessionStatusPollerOptions = {}
): () => void {
	return pollDaemonStatus< DaemonStatus >( {
		intervalMs: options.intervalMs,
		readStatus: options.readStatus ?? ( () => getDaemonStatus() ),
		pushStatus:
			options.pushStatus ??
			( ( status ) => {
				// Project at the IPC boundary — strip `pid` / `pidFile` /
				// `staleFileRemoved` before the payload crosses to the renderer.
				void sendIpcEventToRenderer( 'remote-session-status', toRemoteSessionStatus( status ) );
			} ),
		// Only emit when `running` actually flips. Identical states are silent.
		shouldPush: ( current, lastPushed ) => current.running !== lastPushed?.running,
	} );
}
