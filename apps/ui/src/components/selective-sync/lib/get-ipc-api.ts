import type { Connector } from '@/data/core';
import type { RawDirectoryEntry } from '@studio/common/types/sync-tree';

/**
 * Adapter replacing the legacy renderer's `getIpcApi()` (src/lib/get-ipc-api)
 * for the copied selective-sync modules. Instead of reaching for the Electron
 * bridge directly, every call is served by the active {@link Connector} — the
 * desktop answers from the main process, browser connectors degrade
 * gracefully — so the copied files work unchanged in every host.
 *
 * The connector is registered by the selective-sync entry point (the site
 * dropdown) before the dialog can open.
 */
type SelectiveSyncIpcApi = {
	openURL: ( url: string ) => Promise< void >;
	setTitleBarBackdropEffect: ( enabled: boolean ) => Promise< void >;
	getWpVersion: ( siteId: string ) => Promise< string >;
	getIsMultisite: ( siteId: string ) => Promise< boolean >;
	getDirectorySize: ( siteId: string, path: string[] ) => Promise< number >;
	getFileSize: ( siteId: string, path: string[] ) => Promise< number >;
	listLocalFileTree: (
		siteId: string,
		path: string,
		depth: number
	) => Promise< RawDirectoryEntry[] >;
};

let activeConnector: Connector | undefined;

export function registerSelectiveSyncConnector( connector: Connector ): void {
	activeConnector = connector;
}

function requireConnector(): Connector {
	if ( ! activeConnector ) {
		throw new Error(
			'Selective-sync connector not registered. Call registerSelectiveSyncConnector() first.'
		);
	}
	return activeConnector;
}

export function getIpcApi(): SelectiveSyncIpcApi {
	return {
		openURL: async ( url ) => {
			await requireConnector().openExternalUrl( url );
		},
		setTitleBarBackdropEffect: async ( enabled ) => {
			// Electron-only window chrome tweak; a no-op elsewhere.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			await ( window as any ).ipcApi?.setTitleBarBackdropEffect?.( enabled );
		},
		// Resolve legacy-shaped values (never undefined) so the copied hooks
		// stay byte-identical to their apps/studio sources.
		getWpVersion: ( siteId ) =>
			requireConnector()
				.getWpVersion( siteId )
				.then( ( version ) => version ?? '-' )
				.catch( () => '-' ),
		getIsMultisite: ( siteId ) =>
			requireConnector()
				.getIsMultisite( siteId )
				.then( ( value ) => value ?? false )
				.catch( () => false ),
		getDirectorySize: ( siteId, path ) =>
			requireConnector()
				.getDirectorySize( siteId, path )
				.catch( () => 0 ),
		getFileSize: ( siteId, path ) =>
			requireConnector()
				.getFileSize( siteId, path )
				.catch( () => 0 ),
		listLocalFileTree: ( siteId, path, depth ) =>
			requireConnector()
				.listLocalFileTree( siteId, path, depth )
				.catch( () => [] ),
	};
}
