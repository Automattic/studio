// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import '@sentry/electron/preload';
import { contextBridge, ipcRenderer } from 'electron';
import type * as ipcHandlers from './ipc-handlers';
import type { LogLevel } from './logging';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api: Record< keyof typeof ipcHandlers, ( ...args: any[] ) => any > = {
	archiveSite: ( id: string ) => ipcRenderer.invoke( 'archiveSite', id ),
	deleteSite: ( id: string, deleteFiles: boolean ) =>
		ipcRenderer.invoke( 'deleteSite', id, deleteFiles ),
	createSite: ( path: string ) => ipcRenderer.invoke( 'createSite', path ),
	authenticate: () => ipcRenderer.invoke( 'authenticate' ),
	isAuthenticated: () => ipcRenderer.invoke( 'isAuthenticated' ),
	getAuthenticationToken: () => ipcRenderer.invoke( 'getAuthenticationToken' ),
	clearAuthenticationToken: () => ipcRenderer.invoke( 'clearAuthenticationToken' ),
	saveSnapshotsToStorage: ( snapshots: Snapshot[] ) =>
		ipcRenderer.invoke( 'saveSnapshotsToStorage', snapshots ),
	getSnapshots: () => ipcRenderer.invoke( 'getSnapshots' ),
	getSiteDetails: () => ipcRenderer.invoke( 'getSiteDetails' ),
	openSiteURL: ( id: string, relativeURL = '' ) =>
		ipcRenderer.invoke( 'openSiteURL', id, relativeURL ),
	openURL: ( url: string ) => ipcRenderer.invoke( 'openURL', url ),
	showOpenFolderDialog: ( title: string ) => ipcRenderer.invoke( 'showOpenFolderDialog', title ),
	startServer: ( id: string ) => ipcRenderer.invoke( 'startServer', id ),
	stopServer: ( id: string ) => ipcRenderer.invoke( 'stopServer', id ),
	copyText: ( text: string ) => ipcRenderer.invoke( 'copyText', text ),
	getAppGlobals: () => ipcRenderer.invoke( 'getAppGlobals' ),

	// Use .send instead of .invoke because logging is fire-and-forget
	logRendererMessage: ( level: LogLevel, ...args: any[] ) =>
		ipcRenderer.send( 'logRendererMessage', level, ...args ),
};

contextBridge.exposeInMainWorld( 'ipcApi', api );

const allowedChannels = [ 'test-render-failure' ] as const;

contextBridge.exposeInMainWorld( 'ipcListener', {
	on: ( channel: ( typeof allowedChannels )[ number ], listener: ( ...args: any[] ) => void ) => {
		if ( allowedChannels.includes( channel ) ) {
			ipcRenderer.on( channel, listener );
		} else {
			throw new Error( `Attempted to listen on disallowed IPC channel: ${ channel }` );
		}
	},
	off: ( channel: ( typeof allowedChannels )[ number ], listener: ( ...args: any[] ) => void ) => {
		if ( allowedChannels.includes( channel ) ) {
			ipcRenderer.off( channel, listener );
		} else {
			throw new Error( `Attempted to remove listener on disallowed IPC channel: ${ channel }` );
		}
	},
} );
