import { isRemoteSessionEnabled } from 'cli/lib/feature-flags';
import { getDaemonStatus } from 'cli/remote-session/daemon';
import type { AiOutputAdapter } from 'cli/ai/output-adapter';

const DEFAULT_POLL_INTERVAL_MS = 5000;

/**
 * Start a light poll loop that mirrors the on-disk daemon PID file into the
 * REPL's bottom-bar indicator (`setDaemonStatus`). Returns a stop function.
 *
 * Polling is opt-in: when `STUDIO_ENABLE_REMOTE_SESSION` is off the function
 * does nothing and returns a no-op. The check itself is a synchronous
 * `fs.readFileSync` + `process.kill(pid, 0)` — cheap enough to run every few
 * seconds without measurable overhead.
 */
export function startDaemonStatusPolling(
	ui: AiOutputAdapter,
	options: {
		intervalMs?: number;
		isEnabled?: () => boolean;
		readStatus?: () => { running: boolean; pid?: number };
	} = {}
): () => void {
	const isEnabled = options.isEnabled ?? isRemoteSessionEnabled;
	if ( ! isEnabled() ) {
		return () => undefined;
	}

	const readStatus =
		options.readStatus ??
		( () => {
			const status = getDaemonStatus();
			return status.running && status.pid !== undefined
				? { running: true, pid: status.pid }
				: { running: false };
		} );

	const tick = () => {
		try {
			ui.setDaemonStatus( readStatus() );
		} catch {
			// Reading the PID file is best-effort. A transient read error must
			// not crash the REPL; the next tick will try again.
		}
	};
	tick();
	const timer = setInterval( tick, options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS );
	if ( typeof timer.unref === 'function' ) {
		timer.unref();
	}
	return () => clearInterval( timer );
}
