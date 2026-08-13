import { SyncCommandLoggerAction } from '@studio/common/logger-actions';
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
// after the import starts stay uncancellable by default. Matches the legacy
// renderer's `isKeyUploading` set.
const CANCELLABLE_PUSH_PHASES: PushPhase[] = [ 'creatingBackup', 'uploading' ];

/**
 * A push can be stopped until the remote import is initiated. After that the
 * live site is already being changed and stopping locally would not undo it.
 */
export function canCancelPush( phase: PushPhase | undefined ): boolean {
	// No phase reported yet: the export has not started.
	return phase === undefined || CANCELLABLE_PUSH_PHASES.includes( phase );
}

// Everything the CLI's `pull` reports before it touches the local site. The
// first local write is `stopSite`, and the import actions that follow come from
// a different logger enum — so this is an allow-list rather than a deny-list:
// an action we don't recognise is treated as local work in progress.
const PULL_REMOTE_ACTIONS: string[] = [
	SyncCommandLoggerAction.START_DAEMON,
	SyncCommandLoggerAction.LOAD_SITES,
	SyncCommandLoggerAction.FETCH_REMOTE_SITES,
	SyncCommandLoggerAction.INITIATE_BACKUP,
	SyncCommandLoggerAction.POLL_BACKUP,
	SyncCommandLoggerAction.DOWNLOAD,
];

/**
 * A pull can be stopped while the work is still remote (creating the backup,
 * downloading it). Once the CLI moves on to writing the local site, killing it
 * would leave a half-imported site behind, so cancelling is refused — matching
 * the legacy renderer's `importing` state.
 */
export function canCancelPull( action: string | undefined ): boolean {
	// No progress reported yet: the CLI has not started doing anything local.
	return action === undefined || PULL_REMOTE_ACTIONS.includes( action );
}
