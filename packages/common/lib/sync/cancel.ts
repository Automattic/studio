import { PullCommandLoggerAction } from '@studio/common/logger-actions';
import type { SyncActivity } from '@studio/common/lib/sync/activity';
import type { PushPhase } from '@studio/common/types/sync';

// Kept free of Node imports so the renderers can share these helpers with the
// main process and the `studio ui` server.

// A cancelled sync rejects with this message. Class identity is lost crossing
// IPC and HTTP, so the message is the wire format — see `isSyncCancelledError`.
export const SYNC_CANCELLED_MESSAGE = 'STUDIO_SYNC_CANCELLED';

export class SyncCancelledError extends Error {
	constructor() {
		super( SYNC_CANCELLED_MESSAGE );
		this.name = 'SyncCancelledError';
	}
}

export function isSyncCancelledError( error: unknown ): boolean {
	const message =
		error instanceof Error ? error.message : typeof error === 'string' ? error : String( error );
	// Electron prefixes IPC rejections ("Error invoking remote method …"), and the
	// `studio ui` server relays the message inside a JSON body, so match loosely.
	return message.includes( SYNC_CANCELLED_MESSAGE );
}

// The phases where the work is still local — the export and the upload. Like
// `PULL_REMOTE_ACTIONS` below this is an allow-list, so the remote phases added
// after the import starts stay uncancellable by default.
const CANCELLABLE_PUSH_PHASES: PushPhase[] = [ 'creatingBackup', 'uploading' ];

/**
 * A push can be stopped until the remote import is initiated. After that the
 * live site is already being changed and stopping locally would not undo it.
 */
export function canCancelPush( phase: PushPhase | undefined ): boolean {
	// No phase reported yet: the export has not started.
	return phase === undefined || CANCELLABLE_PUSH_PHASES.includes( phase );
}

// Everything the CLI's `pull` reports before it writes to the local site. This is an allow-list
// rather than a deny-list: an action we don't recognise is treated as local work in progress.
const PULL_REMOTE_ACTIONS: string[] = [
	PullCommandLoggerAction.LOAD_SITES,
	PullCommandLoggerAction.LOAD_WPCOM_SITES,
	PullCommandLoggerAction.PREFLIGHT,
];

/**
 * A pull can be stopped until it starts writing the local site. After that,
 * stopping would leave a half-pulled site behind, so cancelling is refused.
 */
export function canCancelPull( action: string | undefined ): boolean {
	// No progress reported yet: the CLI has not started doing anything local.
	return action === undefined || PULL_REMOTE_ACTIONS.includes( action );
}

/**
 * Whether stopping the CLI now cancels this sync. A push or pull past the
 * point where stopping is safe keeps running instead.
 */
export function canCancelSyncActivity( activity: SyncActivity | null | undefined ): boolean {
	if ( activity?.kind !== 'pending' ) {
		return false;
	}
	if ( activity.direction === 'push' ) {
		return canCancelPush( activity.phase );
	}
	return activity.direction === 'pull' && canCancelPull( activity.action );
}
