// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';
import type { LogLevel } from './logging';
import type * as ipcHandlers from './ipc-handlers';

const api: Record< keyof typeof ipcHandlers, ( ...args: any[] ) => any > = {
	archiveSite: ( id: string ) => ipcRenderer.invoke( 'archiveSite', id ),
	createSite: ( path: string ) => ipcRenderer.invoke( 'createSite', path ),
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
