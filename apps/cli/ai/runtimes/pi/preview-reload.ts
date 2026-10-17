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

// Reports, at the end of each model turn, whether the site the preview shows
// changed on disk during that turn — whatever tool or command changed it.
export function createPreviewChangeDetector( getSitePath: () => string | undefined ) {
	let sitePath: string | undefined;
	let before = 0;
	return ( event: AgentSessionEvent ): boolean => {
		if ( event.type === 'turn_start' ) {
			sitePath = getSitePath();
			before = sitePath ? latestChange( path.join( sitePath, 'wp-content' ) ) : 0;
			return false;
		}
		if ( event.type !== 'turn_end' || ! sitePath || sitePath !== getSitePath() ) {
			return false;
		}
		return latestChange( path.join( sitePath, 'wp-content' ) ) > before;
	};
}
