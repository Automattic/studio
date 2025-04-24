// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import '@sentry/electron/preload';
import { IpcRendererEvent, contextBridge, ipcRenderer, webUtils } from 'electron';
import { IpcEvents } from 'src/ipc-utils';

const api: IpcApi = {
	archiveSite: ( id, format ) => ipcRenderer.invoke( 'archiveSite', id, format ),
	exportSiteToPush: ( id ) => ipcRenderer.invoke( 'exportSiteToPush', id ),
	deleteSite: ( id, deleteFiles ) => ipcRenderer.invoke( 'deleteSite', id, deleteFiles ),
	createSite: ( path, name, wpVersion, customDomain, enableHttps ) =>
		ipcRenderer.invoke( 'createSite', path, name, wpVersion, customDomain, enableHttps ),
	updateSite: ( updatedSite ) => ipcRenderer.invoke( 'updateSite', updatedSite ),
	connectWpcomSites: ( ...args ) => ipcRenderer.invoke( 'connectWpcomSites', ...args ),
	disconnectWpcomSites: ( ...args ) => ipcRenderer.invoke( 'disconnectWpcomSites', ...args ),
	updateConnectedWpcomSites: ( ...args ) =>
		ipcRenderer.invoke( 'updateConnectedWpcomSites', ...args ),
	updateSingleConnectedWpcomSite: ( updatedSite ) =>
		ipcRenderer.invoke( 'updateSingleConnectedWpcomSite', updatedSite ),
	authenticate: () => ipcRenderer.invoke( 'authenticate' ),
	exportSite: ( options, siteId ) => ipcRenderer.invoke( 'exportSite', options, siteId ),
	isAuthenticated: () => ipcRenderer.invoke( 'isAuthenticated' ),
	getAuthenticationToken: () => ipcRenderer.invoke( 'getAuthenticationToken' ),
	clearAuthenticationToken: () => ipcRenderer.invoke( 'clearAuthenticationToken' ),
	saveSnapshotsToStorage: ( snapshots ) =>
		ipcRenderer.invoke( 'saveSnapshotsToStorage', snapshots ),
	getSnapshots: () => ipcRenderer.invoke( 'getSnapshots' ),
	createSnapshot: ( siteFolder ) => ipcRenderer.invoke( 'createSnapshot', siteFolder ),
	updateSnapshot: ( siteFolder, hostname ) =>
		ipcRenderer.invoke( 'updateSnapshot', siteFolder, hostname ),
	deleteSnapshot: ( hostname ) => ipcRenderer.invoke( 'deleteSnapshot', hostname ),
	getRandomUUID: () => ipcRenderer.invoke( 'getRandomUUID' ),
	getLastSeenVersion: () => ipcRenderer.invoke( 'getLastSeenVersion' ),
	saveLastSeenVersion: ( version ) => ipcRenderer.invoke( 'saveLastSeenVersion', version ),
	getSiteDetails: () => ipcRenderer.invoke( 'getSiteDetails' ),
	openSiteURL: ( id, relativeURL = '', { autoLogin = true } = {} ) =>
		ipcRenderer.send( 'openSiteURL', id, relativeURL, { autoLogin } ),
	openURL: ( url ) => ipcRenderer.send( 'openURL', url ),
	showOpenFolderDialog: ( title, defaultDialogPath ) =>
		ipcRenderer.invoke( 'showOpenFolderDialog', title, defaultDialogPath ),
	showSaveAsDialog: ( options ) => ipcRenderer.invoke( 'showSaveAsDialog', options ),
	saveUserLocale: ( locale ) => ipcRenderer.invoke( 'saveUserLocale', locale ),
	getSentryUserId: () => ipcRenderer.invoke( 'getSentryUserId' ),
	getUserLocale: () => ipcRenderer.invoke( 'getUserLocale' ),
	showUserSettings: () => ipcRenderer.invoke( 'showUserSettings' ),
	startServer: ( id ) => ipcRenderer.invoke( 'startServer', id ),
	stopServer: ( id ) => ipcRenderer.invoke( 'stopServer', id ),
	copyText: ( text ) => ipcRenderer.invoke( 'copyText', text ),
	getAppGlobals: () => ipcRenderer.invoke( 'getAppGlobals' ),
	removeTemporalFile: ( path ) => ipcRenderer.invoke( 'removeTemporalFile', path ),
	getWpVersion: ( id ) => ipcRenderer.invoke( 'getWpVersion', id ),
	generateProposedSitePath: ( siteName ) =>
		ipcRenderer.invoke( 'generateProposedSitePath', siteName ),
	openLocalPath: ( path ) => ipcRenderer.send( 'openLocalPath', path ),
	showItemInFolder: ( path ) => ipcRenderer.send( 'showItemInFolder', path ),
	getThemeDetails: ( id ) => ipcRenderer.invoke( 'getThemeDetails', id ),
	getThumbnailData: ( id ) => ipcRenderer.invoke( 'getThumbnailData', id ),
	getInstalledApps: () => ipcRenderer.invoke( 'getInstalledApps' ),
	importSite: ( { id, backupFile } ) => ipcRenderer.invoke( 'importSite', { id, backupFile } ),
	executeWPCLiInline: ( options ) => ipcRenderer.invoke( 'executeWPCLiInline', options ),
	getOnboardingData: () => ipcRenderer.invoke( 'getOnboardingData' ),
	saveOnboarding: ( onboardingCompleted ) =>
		ipcRenderer.invoke( 'saveOnboarding', onboardingCompleted ),
	openTerminalAtPath: ( targetPath, extraParams = {} ) =>
		ipcRenderer.invoke( 'openTerminalAtPath', targetPath, extraParams ),
	showMessageBox: ( options ) => ipcRenderer.invoke( 'showMessageBox', options ),
	showErrorMessageBox: ( options ) => ipcRenderer.send( 'showErrorMessageBox', options ),
	showNotification: ( options ) => ipcRenderer.send( 'showNotification', options ),
	logRendererMessage: ( level, ...args ) =>
		ipcRenderer.send( 'logRendererMessage', level, ...args ),
	setupAppMenu: ( config ) => ipcRenderer.invoke( 'setupAppMenu', config ),
	popupAppMenu: () => ipcRenderer.send( 'popupAppMenu' ),
	openCertificate: () => ipcRenderer.invoke( 'openCertificate' ),
	promptWindowsSpeedUpSites: ( ...args ) =>
		ipcRenderer.invoke( 'promptWindowsSpeedUpSites', ...args ),
	setDefaultLocaleData: ( locale ) => ipcRenderer.invoke( 'setDefaultLocaleData', locale ),
	resetDefaultLocaleData: () => ipcRenderer.invoke( 'resetDefaultLocaleData' ),
	toggleMinWindowWidth: ( isSidebarVisible ) =>
		ipcRenderer.invoke( 'toggleMinWindowWidth', isSidebarVisible ),
	getAbsolutePathFromSite: ( siteId, relativePath ) =>
		ipcRenderer.invoke( 'getAbsolutePathFromSite', siteId, relativePath ),
	openFileInIDE: ( relativePath, siteId ) =>
		ipcRenderer.invoke( 'openFileInIDE', relativePath, siteId ),
	isImportExportSupported: ( siteId ) => ipcRenderer.invoke( 'isImportExportSupported', siteId ),
	checkSyncBackupSize: ( downloadUrl ) => ipcRenderer.invoke( 'checkSyncBackupSize', downloadUrl ),
	downloadSyncBackup: ( remoteSiteId, downloadUrl ) =>
		ipcRenderer.invoke( 'downloadSyncBackup', remoteSiteId, downloadUrl ),
	removeSyncBackup: ( remoteSiteId ) => ipcRenderer.invoke( 'removeSyncBackup', remoteSiteId ),
	getConnectedWpcomSites: ( localSiteId ) =>
		ipcRenderer.invoke( 'getConnectedWpcomSites', localSiteId ),
	addSyncOperation: ( id ) => ipcRenderer.send( 'addSyncOperation', id ),
	clearSyncOperation: ( id ) => ipcRenderer.send( 'clearSyncOperation', id ),
	getWpContentSize: ( id ) => ipcRenderer.invoke( 'getWpContentSize', id ),
	getPathForFile: ( file ) => webUtils.getPathForFile( file ),
	getFileContent: ( filePath ) => ipcRenderer.invoke( 'getFileContent', filePath ),
	isFullscreen: () => ipcRenderer.invoke( 'isFullscreen' ),
	getAllCustomDomains: () => ipcRenderer.invoke( 'getAllCustomDomains' ),
	saveUserTerminal: ( supportedTerminal ) =>
		ipcRenderer.invoke( 'saveUserTerminal', supportedTerminal ),
	getUserTerminal: () => ipcRenderer.invoke( 'getUserTerminal' ),
	getInstalledTerminals: () => ipcRenderer.invoke( 'getInstalledTerminals' ),
	getUserEditor: () => ipcRenderer.invoke( 'getUserEditor' ),
	saveUserEditor: ( editor ) => ipcRenderer.invoke( 'saveUserEditor', editor ),
};

contextBridge.exposeInMainWorld( 'ipcApi', api );

const subscribe = < T extends keyof IpcEvents >(
	channel: T,
	listener: ( event: IpcRendererEvent, ...args: IpcEvents[ T ] ) => void
) => {
	function wrappedListener( event: IpcRendererEvent, ...args: any[] ) {
		listener( event, ...( args as IpcEvents[ T ] ) );
	}

	ipcRenderer.on( channel, wrappedListener );

	return () => {
		ipcRenderer.off( channel, wrappedListener );
	};
};

declare global {
	interface Window {
		ipcListener: {
			subscribe: typeof subscribe;
		};
	}
}

contextBridge.exposeInMainWorld( 'ipcListener', { subscribe } );
