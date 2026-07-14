import { pollDaemonStatus } from '@studio/common/lib/remote-session';
import { getDaemonStatus } from 'cli/remote-session/daemon';
import type { AiOutputAdapter } from 'cli/ai/output-adapter';

interface ReplDaemonStatus {
	running: boolean;
	pid?: number;
}

/**
 * Start a light poll loop that mirrors the on-disk daemon PID file into the
 * REPL's bottom-bar indicator (`setDaemonStatus`). Returns a stop function.
 *
 * The polling skeleton (sync first tick, try/catch per read, `timer.unref()`)
 * lives in `@studio/common/lib/remote-session` and is shared with Studio's
 * renderer-side poller.
 */
export function startDaemonStatusPolling(
	ui: AiOutputAdapter,
	options: {
		intervalMs?: number;
		readStatus?: () => ReplDaemonStatus;
	} = {}
): () => void {
	return pollDaemonStatus< ReplDaemonStatus >( {
		intervalMs: options.intervalMs,
		readStatus:
			options.readStatus ??
			( () => {
				const status = getDaemonStatus();
				return status.running && status.pid !== undefined
					? { running: true, pid: status.pid }
					: { running: false };
			} ),
		pushStatus: ( status ) => ui.setDaemonStatus( status ),
		// REPL pushes every tick (the UI handles idempotent writes); no dedupe.
	} );
}
