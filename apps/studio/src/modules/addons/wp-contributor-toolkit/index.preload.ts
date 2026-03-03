/**
 * WordPress Contributor Toolkit addon — Preload entry.
 *
 * Defines preloadApi only. Runs in the Electron preload context where
 * ipcRenderer is available. Must NOT be imported from the renderer bundle.
 */
import { ipcRenderer } from 'electron';

export const wctPreloadApi: Record< string, ( ...args: unknown[] ) => unknown > = {
	wctGetState: ( ...args ) => ipcRenderer.invoke( 'wct:getState', ...args ),
	wctChooseRepoFolder: ( ...args ) => ipcRenderer.invoke( 'wct:chooseRepoFolder', ...args ),
	wctAddSite: ( ...args ) => ipcRenderer.invoke( 'wct:addSite', ...args ),
	wctRemoveSite: ( ...args ) => ipcRenderer.invoke( 'wct:removeSite', ...args ),
	wctSetActiveSite: ( ...args ) => ipcRenderer.invoke( 'wct:setActiveSite', ...args ),
	wctCreateStudioSite: ( ...args ) => ipcRenderer.invoke( 'wct:createStudioSite', ...args ),
	wctStartSite: ( ...args ) => ipcRenderer.invoke( 'wct:startSite', ...args ),
	wctOpenSiteInBrowser: ( ...args ) => ipcRenderer.invoke( 'wct:openSiteInBrowser', ...args ),
	wctCloneRepo: ( ...args ) => ipcRenderer.invoke( 'wct:cloneRepo', ...args ),
	wctRunNpmInstall: ( ...args ) => ipcRenderer.invoke( 'wct:runNpmInstall', ...args ),
	wctRunBuild: ( ...args ) => ipcRenderer.invoke( 'wct:runBuild', ...args ),
	wctStartWatch: ( ...args ) => ipcRenderer.invoke( 'wct:startWatch', ...args ),
	wctStopWatch: ( ...args ) => ipcRenderer.invoke( 'wct:stopWatch', ...args ),
	wctGetChangedFiles: ( ...args ) => ipcRenderer.invoke( 'wct:getChangedFiles', ...args ),
	wctGeneratePatch: ( ...args ) => ipcRenderer.invoke( 'wct:generatePatch', ...args ),
	wctOpenFolder: ( ...args ) => ipcRenderer.invoke( 'wct:openFolder', ...args ),
};
