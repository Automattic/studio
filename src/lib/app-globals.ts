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

export function isLinux() {
	const platform = process ? process.platform : getAppGlobals().platform;
	return platform === 'linux';
}

export function getPlatformName() {
	const platform = process ? process.platform : getAppGlobals().platform;
	switch ( platform ) {
		case 'darwin':
			return 'macos';
		case 'win32':
			return 'windows';
		case 'linux':
			return 'linux';
		default:
			return 'other';
	}
}
