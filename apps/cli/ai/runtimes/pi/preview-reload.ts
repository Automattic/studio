import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

// Everything a local site renders comes from wp-content: themes, plugins,
// uploads, and the SQLite database. Core files are not the agent's to change.
function latestChange( dir: string ): number {
	let latest = 0;
	let entries;
	try {
		entries = readdirSync( dir, { withFileTypes: true } );
	} catch {
		return latest;
	}
	for ( const entry of entries ) {
		const entryPath = path.join( dir, entry.name );
		if ( entry.isDirectory() ) {
			latest = Math.max( latest, latestChange( entryPath ) );
		} else if ( entry.isFile() ) {
			try {
				latest = Math.max( latest, statSync( entryPath ).mtimeMs );
			} catch {
				// Removed while scanning.
			}
		}
	}
	return latest;
}

// Reports, when the agent finishes a request, whether the site the preview
// shows changed on disk while it worked — whatever tool or command changed it.
// Counting per request rather than per turn bounds the reloads that background
// writes cause (WP-Cron, editor autosaves) to one per request.
export function createPreviewChangeDetector( getSitePath: () => string | undefined ) {
	const startPath = getSitePath();
	const before = startPath ? latestChange( path.join( startPath, 'wp-content' ) ) : 0;
	return ( event: AgentSessionEvent ): boolean => {
		// An `agent_end` that will retry is not the end of the request.
		if ( event.type !== 'agent_end' || event.willRetry ) {
			return false;
		}
		const sitePath = getSitePath();
		if ( ! sitePath ) {
			return false;
		}
		// A site the agent made active during the request is new to the preview.
		if ( sitePath !== startPath ) {
			return true;
		}
		return latestChange( path.join( sitePath, 'wp-content' ) ) > before;
	};
}
