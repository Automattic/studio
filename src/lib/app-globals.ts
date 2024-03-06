export function getAppGlobals(): AppGlobals {
	return window.appGlobals;
}

export function isMac() {
	return getAppGlobals().platform === 'darwin';
}

export function isWindows() {
	return getAppGlobals().platform === 'win32';
}
