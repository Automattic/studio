export function getAppGlobals(): AppGlobals {
	return window.appGlobals;
}

export function isMac() {
	if ( process.env.NODE_ENV === 'test' ) {
		return true;
	}
	return window.platform === 'darwin';
}

export function isWindows() {
	return window.platform === 'win32';
}

export function isLinux() {
	if ( process.env.NODE_ENV === 'test' ) {
		return false;
	}
	const platform = process ? process.platform : window.platform;
	return platform === 'linux';
}
