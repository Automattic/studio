export function getAppGlobals(): AppGlobals {
	// The appGlobals global is set in renderer.ts
	return ( window as any ).appGlobals; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function isMac() {
	return getAppGlobals().platform === 'darwin';
}
