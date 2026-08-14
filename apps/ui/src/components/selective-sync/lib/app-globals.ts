// Adapter replacing the legacy renderer's `src/lib/app-globals` for the copied
// selective-sync modules. In Electron the preload still exposes
// `window.appGlobals`; outside Electron the user agent is a good-enough
// fallback since these values only affect modal chrome.
function getPlatform(): string {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const appGlobals = ( window as any ).appGlobals;
	if ( appGlobals?.platform ) {
		return appGlobals.platform;
	}
	const ua = navigator.platform || navigator.userAgent;
	if ( /mac/i.test( ua ) ) return 'darwin';
	if ( /win/i.test( ua ) ) return 'win32';
	return 'linux';
}

export function isMac() {
	return getPlatform() === 'darwin';
}

export function isWindows() {
	return getPlatform() === 'win32';
}

export function isLinux() {
	return getPlatform() === 'linux';
}
