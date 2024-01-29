export function getAppGlobals(): AppGlobals {
	// Defined in preload.ts
	return ( window as any ).appGlobals;
}

export function isMac() {
	// return getAppGlobals().platform === 'darwin';
	return false;
}
