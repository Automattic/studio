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
	if ( process.env.NODE_ENV === 'test' ) {
		return false;
	}
	return getAppGlobals().platform === 'win32';
}

export function isLinux() {
	if ( process.env.NODE_ENV === 'test' ) {
		return false;
	}
	return getAppGlobals().platform === 'linux';
}

export function isWindowsStore() {
	return getAppGlobals().isWindowsStore;
}
