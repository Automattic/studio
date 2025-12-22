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
	exportSiteForPush: ( id, operationId, configuration ) =>
		ipcRendererInvoke( 'exportSiteForPush', id, operationId, configuration ),
	pushArchive: ( remoteSiteId, archivePath, optionsToSync, specificSelectionPaths ) =>
		ipcRendererInvoke(
			'pushArchive',
			remoteSiteId,
			archivePath,
			optionsToSync,
			specificSelectionPaths
		),
	deleteSite: ( id, deleteFiles ) => ipcRendererInvoke( 'deleteSite', id, deleteFiles ),
	createSite: ( path, config ) => ipcRendererInvoke( 'createSite', path, config ),
	updateSite: ( updatedSite ) => ipcRendererInvoke( 'updateSite', updatedSite ),
	connectWpcomSites: ( ...args ) => ipcRendererInvoke( 'connectWpcomSites', ...args ),
	disconnectWpcomSites: ( ...args ) => ipcRendererInvoke( 'disconnectWpcomSites', ...args ),
	updateConnectedWpcomSites: ( ...args ) =>
		ipcRendererInvoke( 'updateConnectedWpcomSites', ...args ),
	updateSingleConnectedWpcomSite: ( updatedSite ) =>
		ipcRendererInvoke( 'updateSingleConnectedWpcomSite', updatedSite ),
	authenticate: ( isSignup ) => ipcRendererSend( 'authenticate', isSignup ),
	exportSite: ( options ) => ipcRendererInvoke( 'exportSite', options ),
	isAuthenticated: () => ipcRendererInvoke( 'isAuthenticated' ),
	getAuthenticationToken: () => ipcRendererInvoke( 'getAuthenticationToken' ),
	clearAuthenticationToken: () => ipcRendererInvoke( 'clearAuthenticationToken' ),
	saveSnapshotsToStorage: ( snapshots ) => ipcRendererInvoke( 'saveSnapshotsToStorage', snapshots ),
	getSnapshots: () => ipcRendererInvoke( 'getSnapshots' ),
	createSnapshot: ( siteFolder ) => ipcRendererInvoke( 'createSnapshot', siteFolder ),
	updateSnapshot: ( siteFolder, hostname ) =>
		ipcRendererInvoke( 'updateSnapshot', siteFolder, hostname ),
	deleteSnapshot: ( hostname ) => ipcRendererInvoke( 'deleteSnapshot', hostname ),
	getLastSeenVersion: () => ipcRendererInvoke( 'getLastSeenVersion' ),
	saveLastSeenVersion: ( version ) => ipcRendererInvoke( 'saveLastSeenVersion', version ),
	getSiteDetails: () => ipcRendererInvoke( 'getSiteDetails' ),
	getXdebugEnabledSite: () => ipcRendererInvoke( 'getXdebugEnabledSite' ),
	openSiteURL: ( id, relativeURL = '', { autoLogin = true } = {} ) =>
		ipcRendererSend( 'openSiteURL', id, relativeURL, { autoLogin } ),
	openURL: ( url ) => ipcRendererSend( 'openURL', url ),
	showOpenFolderDialog: ( title, defaultDialogPath ) =>
		ipcRendererInvoke( 'showOpenFolderDialog', title, defaultDialogPath ),
	isCATrusted: () => ipcRenderer.invoke( 'isCATrusted' ),
	trustCertificate: () => ipcRenderer.invoke( 'trustCertificate' ),
	showSaveAsDialog: ( options ) => ipcRendererInvoke( 'showSaveAsDialog', options ),
	saveUserLocale: ( locale ) => ipcRendererInvoke( 'saveUserLocale', locale ),
	getSentryUserId: () => ipcRendererInvoke( 'getSentryUserId' ),
	getUserLocale: () => ipcRendererInvoke( 'getUserLocale' ),
	showUserSettings: ( tabName ) => ipcRendererInvoke( 'showUserSettings', tabName ),
	startServer: ( id ) => ipcRendererInvoke( 'startServer', id ),
	stopServer: ( id ) => ipcRendererInvoke( 'stopServer', id ),
	copyText: ( text ) => ipcRendererInvoke( 'copyText', text ),
	getAppGlobals: () => ipcRendererInvoke( 'getAppGlobals' ),
	removeExportedSiteTmpFile: ( path ) => ipcRendererInvoke( 'removeExportedSiteTmpFile', path ),
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
	getBetaFeatures: () => ipcRendererInvoke( 'getBetaFeatures' ),
	openAppAtPath: ( editorKey, filePath ) =>
		ipcRendererInvoke( 'openAppAtPath', editorKey, filePath ),
	openTerminalAtPath: ( targetPath ) => ipcRendererInvoke( 'openTerminalAtPath', targetPath ),
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
	downloadSyncBackup: ( remoteSiteId, downloadUrl, operationId ) =>
		ipcRendererInvoke( 'downloadSyncBackup', remoteSiteId, downloadUrl, operationId ),
	removeSyncBackup: ( remoteSiteId ) => ipcRendererInvoke( 'removeSyncBackup', remoteSiteId ),
	getConnectedWpcomSites: ( localSiteId ) =>
		ipcRendererInvoke( 'getConnectedWpcomSites', localSiteId ),
	addSyncOperation: ( id, status ) => ipcRendererSend( 'addSyncOperation', id, status ),
	clearSyncOperation: ( id ) => ipcRendererSend( 'clearSyncOperation', id ),
	cancelSyncOperation: ( id ) => ipcRendererSend( 'cancelSyncOperation', id ),
	getDirectorySize: ( id, subdir ) => ipcRendererInvoke( 'getDirectorySize', id, subdir ),
	getFileSize: ( id, filePath ) => ipcRendererInvoke( 'getFileSize', id, filePath ),
	getPathForFile: ( file ) => webUtils.getPathForFile( file ),
	isFullscreen: () => ipcRendererInvoke( 'isFullscreen' ),
	getAllCustomDomains: () => ipcRendererInvoke( 'getAllCustomDomains' ),
	saveUserTerminal: ( preferredTerminal ) =>
		ipcRendererInvoke( 'saveUserTerminal', preferredTerminal ),
	getUserTerminal: () => ipcRendererInvoke( 'getUserTerminal' ),
	getUserEditor: () => ipcRendererInvoke( 'getUserEditor' ),
	saveUserEditor: ( editor ) => ipcRendererInvoke( 'saveUserEditor', editor ),
	comparePaths: ( path1, path2 ) => ipcRendererInvoke( 'comparePaths', path1, path2 ),
	listLocalFileTree: ( siteId, path, maxDepth ) =>
		ipcRenderer.invoke( 'listLocalFileTree', siteId, path, maxDepth ),
	getProviderConstants: () => ipcRendererInvoke( 'getProviderConstants' ),
	validateBlueprint: ( blueprintJson ) => ipcRendererInvoke( 'validateBlueprint', blueprintJson ),
	readBlueprintFile: ( filePath ) => ipcRendererInvoke( 'readBlueprintFile', filePath ),
	showSiteContextMenu: ( context ) => ipcRendererSend( 'showSiteContextMenu', context ),
	setWindowControlVisibility: ( visible ) =>
		ipcRendererInvoke( 'setWindowControlVisibility', visible ),
	isStudioCliInstalled: () => ipcRendererInvoke( 'isStudioCliInstalled' ),
	installStudioCli: () => ipcRendererInvoke( 'installStudioCli' ),
	uninstallStudioCli: () => ipcRendererInvoke( 'uninstallStudioCli' ),
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
