import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';

// Adapter replacing the legacy renderer's `getIpcApi()` (src/lib/get-ipc-api)
// for the copied selective-sync modules. In Electron the same preload bridge
// the legacy renderer uses is available on `window.ipcApi`; outside Electron
// (local-web/hosted) each method degrades gracefully so the dialog still
// renders without size estimates and version warnings.
type SelectiveSyncIpcApi = {
	openURL: ( url: string ) => Promise< void >;
	setTitleBarBackdropEffect: ( enabled: boolean ) => Promise< void >;
	getWpVersion: ( siteId: string ) => Promise< string | undefined >;
	getIsMultisite: ( siteId: string ) => Promise< boolean | undefined >;
	getDirectorySize: ( siteId: string, path: string[] ) => Promise< number >;
	getFileSize: ( siteId: string, path: string[] ) => Promise< number >;
	listLocalFileTree: (
		siteId: string,
		path: string,
		depth: number
	) => Promise< RawDirectoryEntry[] >;
};

export function getIpcApi(): SelectiveSyncIpcApi {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const ipcApi = ( window as any ).ipcApi;
	if ( ipcApi ) {
		return ipcApi as SelectiveSyncIpcApi;
	}
	return {
		openURL: async ( url ) => {
			window.open( url, '_blank', 'noreferrer' );
		},
		setTitleBarBackdropEffect: async () => undefined,
		getWpVersion: async () => undefined,
		getIsMultisite: async () => undefined,
		getDirectorySize: async () => 0,
		getFileSize: async () => 0,
		listLocalFileTree: async () => [],
	};
}
