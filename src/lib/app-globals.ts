export function getAppGlobals(): AppGlobals {
	// The appGlobals global is defined in preload.ts
	return ( window as any ).appGlobals; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function isMac() {
	return getAppGlobals().platform === 'darwin';
}
