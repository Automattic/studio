// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';
import type * as ipcHandlers from './ipc-handlers';

const api: Record< keyof typeof ipcHandlers, ( ...args: any[] ) => any > = {
	ping: ( message: string ) => ipcRenderer.invoke( 'ping', message ),
};

contextBridge.exposeInMainWorld( 'ipcApi', api );
