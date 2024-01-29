// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import '@sentry/electron/preload';
import { contextBridge, ipcRenderer } from 'electron';
import type * as ipcHandlers from './ipc-handlers';
import type { LogLevel } from './logging';

const api: Record< keyof typeof ipcHandlers, ( ...args: any[] ) => any > = {
	archiveSite: ( id: string ) => ipcRenderer.invoke( 'archiveSite', id ),
	createSite: ( path: string ) => ipcRenderer.invoke( 'createSite', path ),
	authenticate: () => ipcRenderer.invoke( 'authenticate' ),
	isAuthenticated: () => ipcRenderer.invoke( 'isAuthenticated' ),
	getAuthenticationToken: () => ipcRenderer.invoke( 'getAuthenticationToken' ),
	clearAuthenticationToken: () => ipcRenderer.invoke( 'clearAuthenticationToken' ),
	getSiteDetails: () => ipcRenderer.invoke( 'getSiteDetails' ),
	openSiteURL: ( id: string, relativeURL = '' ) =>
		ipcRenderer.invoke( 'openSiteURL', id, relativeURL ),
	showOpenFolderDialog: ( title: string ) => ipcRenderer.invoke( 'showOpenFolderDialog', title ),
	startServer: ( id: string ) => ipcRenderer.invoke( 'startServer', id ),
	stopServer: ( id: string ) => ipcRenderer.invoke( 'stopServer', id ),

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

const appGlobals: AppGlobals = {
	platform: process.platform,
};

contextBridge.exposeInMainWorld( 'appGlobals', appGlobals );
