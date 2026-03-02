/**
 * VIP addon — Preload entry.
 *
 * Defines preloadApi only. Runs in the Electron preload context where
 * ipcRenderer is available. Must NOT be imported from the renderer bundle.
 */
import { ipcRenderer } from 'electron';

export const vipPreloadApi: Record< string, ( ...args: unknown[] ) => unknown > = {
	vipIsCliAvailable: ( ...args ) => ipcRenderer.invoke( 'vip:isCliAvailable', ...args ),
	vipGetEnvironments: ( ...args ) => ipcRenderer.invoke( 'vip:getEnvironments', ...args ),
	vipGetEnvironmentDetails: ( ...args ) =>
		ipcRenderer.invoke( 'vip:getEnvironmentDetails', ...args ),
	vipStartEnvironment: ( ...args ) => ipcRenderer.invoke( 'vip:startEnvironment', ...args ),
	vipStopEnvironment: ( ...args ) => ipcRenderer.invoke( 'vip:stopEnvironment', ...args ),
	vipExecuteVipCliCommand: ( ...args ) => ipcRenderer.invoke( 'vip:executeVipCliCommand', ...args ),
	vipOpenEnvironmentFolder: ( ...args ) =>
		ipcRenderer.invoke( 'vip:openEnvironmentFolder', ...args ),
	vipOpenAppCodeFolder: ( ...args ) => ipcRenderer.invoke( 'vip:openAppCodeFolder', ...args ),
	vipOpenEnvironmentInBrowser: ( ...args ) =>
		ipcRenderer.invoke( 'vip:openEnvironmentInBrowser', ...args ),
	vipGetVipDataPath: ( ...args ) => ipcRenderer.invoke( 'vip:getVipDataPath', ...args ),
	vipCreateEnvironment: ( ...args ) => ipcRenderer.invoke( 'vip:createEnvironment', ...args ),
};
