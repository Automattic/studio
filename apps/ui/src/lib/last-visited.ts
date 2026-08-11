/**
 * Remembers the most recently visited session/site so the `/` index route
 * can return the user to where they were, instead of always landing on the
 * first site in the list. Values are validated against live data at
 * redirect time, so stale ids (deleted sites/sessions) just fall through.
 */

export interface LastVisited {
	sessionId?: string;
	siteId?: string;
}

const STORAGE_KEY = 'studio-ui-last-visited-v1';

export function readLastVisited(): LastVisited {
	try {
		const stored = window.localStorage.getItem( STORAGE_KEY );
		const parsed = stored ? JSON.parse( stored ) : {};
		return {
			sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined,
			siteId: typeof parsed.siteId === 'string' ? parsed.siteId : undefined,
		};
	} catch {
		return {};
	}
}

export function writeLastVisited( next: LastVisited ): void {
	try {
		window.localStorage.setItem( STORAGE_KEY, JSON.stringify( next ) );
	} catch {
		// Best-effort; without it the index route falls back to the first site.
	}
}
