export function getAppGlobals(): AppGlobals {
	return window.appGlobals;
}

export function isMac() {
	return getAppGlobals().platform === 'darwin';
}
