// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import '@sentry/electron/preload';
import { IpcRendererEvent, contextBridge, ipcRenderer, webUtils } from 'electron';
import { IpcEvents } from 'src/ipc-utils';

function ipcRendererInvoke< T extends keyof IpcHandlers >(
	channel: T,
	...args: WithoutIpcEvent< Parameters< IpcHandlers[ T ] > >
) {
	return ipcRenderer.invoke( channel, ...args );
}

function ipcRendererSend< T extends keyof IpcHandlers >(
	channel: T,
	...args: WithoutIpcEvent< Parameters< IpcHandlers[ T ] > >
) {
	ipcRenderer.send( channel, ...args );
	return undefined;
}

const api: IpcApi = {
	archiveSite: ( id, format ) => ipcRendererInvoke( 'archiveSite', id, format ),
	exportSiteToPush: ( id ) => ipcRendererInvoke( 'exportSiteToPush', id ),
	deleteSite: ( id, deleteFiles ) => ipcRendererInvoke( 'deleteSite', id, deleteFiles ),
	createSite: ( path, name, wpVersion, customDomain, enableHttps ) =>
		ipcRendererInvoke( 'createSite', path, name, wpVersion, customDomain, enableHttps ),
	updateSite: ( updatedSite ) => ipcRendererInvoke( 'updateSite', updatedSite ),
	connectWpcomSites: ( ...args ) => ipcRendererInvoke( 'connectWpcomSites', ...args ),
	disconnectWpcomSites: ( ...args ) => ipcRendererInvoke( 'disconnectWpcomSites', ...args ),
	updateConnectedWpcomSites: ( ...args ) =>
		ipcRendererInvoke( 'updateConnectedWpcomSites', ...args ),
	updateSingleConnectedWpcomSite: ( updatedSite ) =>
		ipcRendererInvoke( 'updateSingleConnectedWpcomSite', updatedSite ),
	authenticate: ( isSignup ) => ipcRendererSend( 'authenticate', isSignup ),
	exportSite: ( options, siteId ) => ipcRendererInvoke( 'exportSite', options, siteId ),
	isAuthenticated: () => ipcRendererInvoke( 'isAuthenticated' ),
	getAuthenticationToken: () => ipcRendererInvoke( 'getAuthenticationToken' ),
	clearAuthenticationToken: () => ipcRendererInvoke( 'clearAuthenticationToken' ),
	saveSnapshotsToStorage: ( snapshots ) => ipcRendererInvoke( 'saveSnapshotsToStorage', snapshots ),
	getSnapshots: () => ipcRendererInvoke( 'getSnapshots' ),
	createSnapshot: ( siteFolder ) => ipcRendererInvoke( 'createSnapshot', siteFolder ),
	updateSnapshot: ( siteFolder, hostname ) =>
		ipcRendererInvoke( 'updateSnapshot', siteFolder, hostname ),
	deleteSnapshot: ( hostname ) => ipcRendererInvoke( 'deleteSnapshot', hostname ),
	getRandomUUID: () => ipcRendererInvoke( 'getRandomUUID' ),
	getLastSeenVersion: () => ipcRendererInvoke( 'getLastSeenVersion' ),
	saveLastSeenVersion: ( version ) => ipcRendererInvoke( 'saveLastSeenVersion', version ),
	getSiteDetails: () => ipcRendererInvoke( 'getSiteDetails' ),
	openSiteURL: ( id, relativeURL = '', { autoLogin = true } = {} ) =>
		ipcRendererSend( 'openSiteURL', id, relativeURL, { autoLogin } ),
	openURL: ( url ) => ipcRendererSend( 'openURL', url ),
	showOpenFolderDialog: ( title, defaultDialogPath ) =>
		ipcRendererInvoke( 'showOpenFolderDialog', title, defaultDialogPath ),
	showSaveAsDialog: ( options ) => ipcRendererInvoke( 'showSaveAsDialog', options ),
	saveUserLocale: ( locale ) => ipcRendererInvoke( 'saveUserLocale', locale ),
	getSentryUserId: () => ipcRendererInvoke( 'getSentryUserId' ),
	getUserLocale: () => ipcRendererInvoke( 'getUserLocale' ),
	showUserSettings: () => ipcRendererInvoke( 'showUserSettings' ),
	startServer: ( id ) => ipcRendererInvoke( 'startServer', id ),
	stopServer: ( id ) => ipcRendererInvoke( 'stopServer', id ),
	copyText: ( text ) => ipcRendererInvoke( 'copyText', text ),
	getAppGlobals: () => ipcRendererInvoke( 'getAppGlobals' ),
	removeTemporalFile: ( path ) => ipcRendererInvoke( 'removeTemporalFile', path ),
	getWpVersion: ( id ) => ipcRendererInvoke( 'getWpVersion', id ),
	generateProposedSitePath: ( siteName ) =>
		ipcRendererInvoke( 'generateProposedSitePath', siteName ),
	openLocalPath: ( path ) => ipcRendererSend( 'openLocalPath', path ),
	showItemInFolder: ( path ) => ipcRendererSend( 'showItemInFolder', path ),
	getThemeDetails: ( id ) => ipcRendererInvoke( 'getThemeDetails', id ),
	getThumbnailData: ( id ) => ipcRendererInvoke( 'getThumbnailData', id ),
	getInstalledAppsAndTerminals: () => ipcRendererInvoke( 'getInstalledAppsAndTerminals' ),
	importSite: ( { id, backupFile } ) => ipcRendererInvoke( 'importSite', { id, backupFile } ),
	executeWPCLiInline: ( options ) => ipcRendererInvoke( 'executeWPCLiInline', options ),
	getOnboardingData: () => ipcRendererInvoke( 'getOnboardingData' ),
	saveOnboarding: ( onboardingCompleted ) =>
		ipcRendererInvoke( 'saveOnboarding', onboardingCompleted ),
	openTerminalAtPath: ( targetPath, extraParams = {} ) =>
		ipcRendererInvoke( 'openTerminalAtPath', targetPath, extraParams ),
	showMessageBox: ( options ) => ipcRendererInvoke( 'showMessageBox', options ),
	showErrorMessageBox: ( options ) => ipcRendererSend( 'showErrorMessageBox', options ),
	showNotification: ( options ) => ipcRendererSend( 'showNotification', options ),
	logRendererMessage: ( level, ...args ) => ipcRendererSend( 'logRendererMessage', level, ...args ),
	setupAppMenu: ( config ) => ipcRendererInvoke( 'setupAppMenu', config ),
	popupAppMenu: () => ipcRendererSend( 'popupAppMenu' ),
	openCertificate: () => ipcRendererSend( 'openCertificate' ),
	promptWindowsSpeedUpSites: ( ...args ) =>
		ipcRendererInvoke( 'promptWindowsSpeedUpSites', ...args ),
	setDefaultLocaleData: ( locale ) => ipcRendererInvoke( 'setDefaultLocaleData', locale ),
	resetDefaultLocaleData: () => ipcRendererInvoke( 'resetDefaultLocaleData' ),
	toggleMinWindowWidth: ( isSidebarVisible ) =>
		ipcRendererInvoke( 'toggleMinWindowWidth', isSidebarVisible ),
	getAbsolutePathFromSite: ( siteId, relativePath ) =>
		ipcRendererInvoke( 'getAbsolutePathFromSite', siteId, relativePath ),
	openFileInIDE: ( relativePath, siteId ) =>
		ipcRendererSend( 'openFileInIDE', relativePath, siteId ),
	isImportExportSupported: ( siteId ) => ipcRendererInvoke( 'isImportExportSupported', siteId ),
	checkSyncBackupSize: ( downloadUrl ) => ipcRendererInvoke( 'checkSyncBackupSize', downloadUrl ),
	downloadSyncBackup: ( remoteSiteId, downloadUrl ) =>
		ipcRendererInvoke( 'downloadSyncBackup', remoteSiteId, downloadUrl ),
	removeSyncBackup: ( remoteSiteId ) => ipcRendererInvoke( 'removeSyncBackup', remoteSiteId ),
	getConnectedWpcomSites: ( localSiteId ) =>
		ipcRendererInvoke( 'getConnectedWpcomSites', localSiteId ),
	addSyncOperation: ( id ) => ipcRendererSend( 'addSyncOperation', id ),
	clearSyncOperation: ( id ) => ipcRendererSend( 'clearSyncOperation', id ),
	getWpContentSize: ( id ) => ipcRendererInvoke( 'getWpContentSize', id ),
	getPathForFile: ( file ) => webUtils.getPathForFile( file ),
	getFileContent: ( filePath ) => ipcRendererInvoke( 'getFileContent', filePath ),
	isFullscreen: () => ipcRendererInvoke( 'isFullscreen' ),
	getAllCustomDomains: () => ipcRendererInvoke( 'getAllCustomDomains' ),
	saveUserTerminal: ( preferredTerminal ) =>
		ipcRendererInvoke( 'saveUserTerminal', preferredTerminal ),
	getUserTerminal: () => ipcRendererInvoke( 'getUserTerminal' ),
	getUserEditor: () => ipcRendererInvoke( 'getUserEditor' ),
	saveUserEditor: ( editor ) => ipcRendererInvoke( 'saveUserEditor', editor ),
	handleNewSite: ( newSite ) => ipcRendererInvoke( 'handleNewSite', newSite ),
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
