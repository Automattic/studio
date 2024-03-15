// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import '@sentry/electron/preload';
import { contextBridge, ipcRenderer } from 'electron';
import type { LogLevel } from './logging';

const api: IpcApi = {
	archiveSite: ( id: string ) => ipcRenderer.invoke( 'archiveSite', id ),
	deleteSite: ( id: string, deleteFiles?: boolean ) =>
		ipcRenderer.invoke( 'deleteSite', id, deleteFiles ),
	createSite: ( path: string, name?: string ) => ipcRenderer.invoke( 'createSite', path, name ),
	updateSite: ( updatedSite: SiteDetails ) => ipcRenderer.invoke( 'updateSite', updatedSite ),
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
	showUserSettings: () => ipcRenderer.invoke( 'showUserSettings' ),
	startServer: ( id: string ) => ipcRenderer.invoke( 'startServer', id ),
	stopServer: ( id: string ) => ipcRenderer.invoke( 'stopServer', id ),
	copyText: ( text: string ) => ipcRenderer.invoke( 'copyText', text ),
	getAppGlobals: () => ipcRenderer.invoke( 'getAppGlobals' ),
	removeTemporalFile: ( path: string ) => ipcRenderer.invoke( 'removeTemporalFile', path ),
	getWpVersion: ( wordPressPath: string ) => ipcRenderer.invoke( 'getWpVersion', wordPressPath ),
	generateProposedSitePath: ( siteName: string ) =>
		ipcRenderer.invoke( 'generateProposedSitePath', siteName ),
	openLocalPath: ( path: string ) => ipcRenderer.invoke( 'openLocalPath', path ),
	getThemeDetails: ( id: string ) => ipcRenderer.invoke( 'getThemeDetails', id ),
	getThumbnailData: ( id: string ) => ipcRenderer.invoke( 'getThumbnailData', id ),

	// Use .send instead of .invoke because logging is fire-and-forget
	logRendererMessage: ( level: LogLevel, ...args: any[] ) =>
		ipcRenderer.send( 'logRendererMessage', level, ...args ),
};

contextBridge.exposeInMainWorld( 'ipcApi', api );

const allowedChannels = [
	'test-render-failure',
	'add-site',
	'user-settings',
	'auth-updated',
] as const;

contextBridge.exposeInMainWorld( 'ipcListener', {
	subscribe: (
		channel: ( typeof allowedChannels )[ number ],
		listener: ( ...args: any[] ) => void
	) => {
		if ( allowedChannels.includes( channel ) ) {
			ipcRenderer.on( channel, listener );
			return () => {
				ipcRenderer.off( channel, listener );
			};
		} else {
			throw new Error( `Attempted to listen on disallowed IPC channel: ${ channel }` );
		}
	},
} );
