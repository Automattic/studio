import { BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { extractAiSessionIdFromFilePath } from '@studio/common/ai/sessions/file-naming';
import { getAiSessionsRootDirectory } from 'src/lib/ai-sessions';

/**
 * Emits `ai-session-changed` IPC events to every renderer whenever a session
 * JSONL is written anywhere under the sessions root (UI flips, CLI appends,
 * hand edits — anything). Debounced per-file so a burst of appends during a
 * single agent turn coalesces into one invalidation.
 *
 * React-query is the renderer-side authority for cache freshness; the watcher
 * just tells it "this session changed, refetch." Combined with the pure
 * reducer + derivation-on-read model, any edit surfaces uniformly.
 */

const DEBOUNCE_MS = 100;

export function startAiSessionFileWatcher(): void {
	const root = getAiSessionsRootDirectory();

	try {
		fs.mkdirSync( root, { recursive: true } );
	} catch {
		// If the directory can't be created the watcher will fail cleanly below.
	}

	const pending = new Map< string, NodeJS.Timeout >();

	let watcher: fs.FSWatcher;
	try {
		watcher = fs.watch( root, { recursive: true, persistent: false }, ( _eventType, filename ) => {
			if ( ! filename ) {
				return;
			}

			const fullPath = path.join( root, filename );
			if ( ! fullPath.endsWith( '.jsonl' ) ) {
				return;
			}

			const sessionId = extractAiSessionIdFromFilePath( fullPath );
			if ( ! sessionId ) {
				return;
			}

			const existing = pending.get( sessionId );
			if ( existing ) {
				clearTimeout( existing );
			}

			pending.set(
				sessionId,
				setTimeout( () => {
					pending.delete( sessionId );
					broadcast( sessionId );
				}, DEBOUNCE_MS )
			);
		} );
	} catch ( error ) {
		// `fs.watch` with `recursive` is supported on macOS and Windows; Linux
		// may throw ENOSYS. Fall back to a no-op — the renderer will still
		// refresh on explicit mutation invalidations.
		console.warn(
			'Failed to start AI sessions file watcher; external edits will not be observed.',
			error
		);
		return;
	}

	const cleanup = () => {
		for ( const timer of pending.values() ) {
			clearTimeout( timer );
		}
		pending.clear();
		try {
			watcher.close();
		} catch {
			// ignore
		}
	};

	process.once( 'exit', cleanup );
}

function broadcast( sessionId: string ): void {
	for ( const window of BrowserWindow.getAllWindows() ) {
		if ( window.isDestroyed() ) {
			continue;
		}
		window.webContents.send( 'ai-session-changed', { sessionId } );
	}
}
