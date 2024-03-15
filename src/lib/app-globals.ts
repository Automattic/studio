export function getAppGlobals(): AppGlobals {
	return window.appGlobals;
}

export function isMac() {
	if ( process.env.NODE_ENV === 'test' ) {
		return true;
	}
	return getAppGlobals().platform === 'darwin';
}

export function isWindows() {
	return getAppGlobals().platform === 'win32';
}
