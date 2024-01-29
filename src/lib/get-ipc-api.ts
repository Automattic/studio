export function getIpcApi(): IpcApi {
	// Defined in preload.ts
	return ( window as any ).ipcApi;
}
