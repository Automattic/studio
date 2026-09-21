// App version the What's New announcements were last dismissed on. The desktop
// keeps this in appdata via IPC — shared with the classic renderer — but the
// browser connectors have no such store, so it lives in localStorage per origin.
const LAST_SEEN_VERSION_STORAGE_KEY = 'studio-whats-new-last-seen-version';

export function readLastSeenVersion(): string | undefined {
	return window.localStorage.getItem( LAST_SEEN_VERSION_STORAGE_KEY ) ?? undefined;
}

export function writeLastSeenVersion( version: string ): void {
	window.localStorage.setItem( LAST_SEEN_VERSION_STORAGE_KEY, version );
}
