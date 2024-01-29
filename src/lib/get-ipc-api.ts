export function getIpcApi(): IpcApi {
	// The ipcApi global is defined in preload.ts
	return ( window as any ).ipcApi; // eslint-disable-line @typescript-eslint/no-explicit-any
}
