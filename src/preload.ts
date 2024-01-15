// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';
import type * as ipcHandlers from './ipc-handlers';

const api: Record< keyof typeof ipcHandlers, ( ...args: any[] ) => any > = {
	createSite: ( path: string ) => ipcRenderer.invoke( 'createSite', path ),
	getSiteDetails: () => ipcRenderer.invoke( 'getSiteDetails' ),
	ping: ( message: string ) => ipcRenderer.invoke( 'ping', message ),
};

contextBridge.exposeInMainWorld( 'ipcApi', api );
