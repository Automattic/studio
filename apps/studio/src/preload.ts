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
	pushSiteToLive: ( selectedSiteId, remoteSiteId, options ) =>
		ipcRendererInvoke( 'pushSiteToLive', selectedSiteId, remoteSiteId, options ),
	deleteSite: ( id, deleteFiles ) => ipcRendererInvoke( 'deleteSite', id, deleteFiles ),
	copySite: ( sourceSiteId, newSiteId, siteName ) =>
		ipcRendererInvoke( 'copySite', sourceSiteId, newSiteId, siteName ),
	createSite: ( path, config ) => ipcRendererInvoke( 'createSite', path, config ),
	updateSite: ( updatedSite, wpVersion ) =>
		ipcRendererInvoke( 'updateSite', updatedSite, wpVersion ),
	connectWpcomSites: ( ...args ) => ipcRendererInvoke( 'connectWpcomSites', ...args ),
	disconnectWpcomSites: ( ...args ) => ipcRendererInvoke( 'disconnectWpcomSites', ...args ),
	authenticate: ( isSignup, source ) => ipcRendererSend( 'authenticate', isSignup, source ),
	exportSite: ( site, destinationPath, options ) =>
		ipcRendererInvoke( 'exportSite', site, destinationPath, options ),
	getAuthenticationToken: () => ipcRendererInvoke( 'getAuthenticationToken' ),
	clearAuthenticationToken: () => ipcRendererInvoke( 'clearAuthenticationToken' ),
	fetchSnapshots: () => ipcRendererInvoke( 'fetchSnapshots' ),
	publishPreviewSite: ( siteFolder, hostname, name ) =>
		ipcRendererInvoke( 'publishPreviewSite', siteFolder, hostname, name ),
	deletePreviewSite: ( hostname ) => ipcRendererInvoke( 'deletePreviewSite', hostname ),
	renamePreviewSite: ( hostname, name ) => ipcRendererInvoke( 'renamePreviewSite', hostname, name ),
	deleteAllSnapshots: () => ipcRendererInvoke( 'deleteAllSnapshots' ),
	getLastSeenVersion: () => ipcRendererInvoke( 'getLastSeenVersion' ),
	saveLastSeenVersion: ( version ) => ipcRendererInvoke( 'saveLastSeenVersion', version ),
	getSiteDetails: () => ipcRendererInvoke( 'getSiteDetails' ),
	openSiteURL: ( id, relativeURL = '', { autoLogin = true } = {} ) =>
		ipcRendererSend( 'openSiteURL', id, relativeURL, { autoLogin } ),
	openURL: ( url ) => ipcRendererSend( 'openURL', url ),
	showOpenFolderDialog: ( title, defaultDialogPath ) =>
		ipcRendererInvoke( 'showOpenFolderDialog', title, defaultDialogPath ),
	isCATrusted: () => ipcRenderer.invoke( 'isCATrusted' ),
	trustCertificate: () => ipcRenderer.invoke( 'trustCertificate' ),
	showSaveAsDialog: ( options ) => ipcRendererInvoke( 'showSaveAsDialog', options ),
	startServer: ( id ) => ipcRendererInvoke( 'startServer', id ),
	stopServer: ( id ) => ipcRendererInvoke( 'stopServer', id ),
	copyText: ( text ) => ipcRendererInvoke( 'copyText', text ),
	getAppGlobals: () => ipcRendererInvoke( 'getAppGlobals' ),
	getAppUpdateStatus: () => ipcRendererInvoke( 'getAppUpdateStatus' ),
	installAppUpdate: () => ipcRendererInvoke( 'installAppUpdate' ),
	getWpVersion: ( id ) => ipcRendererInvoke( 'getWpVersion', id ),
	getSiteDesign: ( id ) => ipcRendererInvoke( 'getSiteDesign', id ),
	fixSiteDesignDrift: ( id, fixes ) => ipcRendererInvoke( 'fixSiteDesignDrift', id, fixes ),
	getIsMultisite: ( id ) => ipcRendererInvoke( 'getIsMultisite', id ),
	fetchSiteRestApi: ( siteId, request ) => ipcRendererInvoke( 'fetchSiteRestApi', siteId, request ),
	generateProposedSitePath: ( siteName ) =>
		ipcRendererInvoke( 'generateProposedSitePath', siteName ),
	generateSiteNameFromList: ( usedSites ) =>
		ipcRendererInvoke( 'generateSiteNameFromList', usedSites ),
	generateNumberedNameFromList: ( baseName, usedSites ) =>
		ipcRendererInvoke( 'generateNumberedNameFromList', baseName, usedSites ),
	openLocalPath: ( path ) => ipcRendererSend( 'openLocalPath', path ),
	openStudioLogs: () => ipcRendererSend( 'openStudioLogs' ),
	getSiteIcon: ( id ) => ipcRendererInvoke( 'getSiteIcon', id ),
	getThumbnailData: ( id ) => ipcRendererInvoke( 'getThumbnailData', id ),
	getInstalledAppsAndTerminals: () => ipcRendererInvoke( 'getInstalledAppsAndTerminals' ),
	importSite: ( siteId, importArchivePath, options ) =>
		ipcRendererInvoke( 'importSite', siteId, importArchivePath, options ),
	getOnboardingData: () => ipcRendererInvoke( 'getOnboardingData' ),
	saveOnboarding: ( onboardingCompleted ) =>
		ipcRendererInvoke( 'saveOnboarding', onboardingCompleted ),
	openAppAtPath: ( editorKey, filePath, otherFiles?: string[] ) =>
		ipcRendererInvoke( 'openAppAtPath', editorKey, filePath, otherFiles ),
	openTerminalAtPath: ( targetPath ) => ipcRendererInvoke( 'openTerminalAtPath', targetPath ),
	showMessageBox: ( options ) => ipcRendererInvoke( 'showMessageBox', options ),
	showErrorMessageBox: ( options ) => ipcRendererSend( 'showErrorMessageBox', options ),
	setupAppMenu: () => ipcRendererInvoke( 'setupAppMenu' ),
	popupAppMenu: ( position ) => ipcRendererSend( 'popupAppMenu', position ),
	ensureMinWindowWidth: ( minimumWidth ) =>
		ipcRendererInvoke( 'ensureMinWindowWidth', minimumWidth ),
	getAbsolutePathFromSite: ( siteId, relativePath ) =>
		ipcRendererInvoke( 'getAbsolutePathFromSite', siteId, relativePath ),
	getConnectedWpcomSites: ( localSiteId ) =>
		ipcRendererInvoke( 'getConnectedWpcomSites', localSiteId ),
	fetchSyncableWpcomSites: () => ipcRendererInvoke( 'fetchSyncableWpcomSites' ),
	getHostingPhpVersion: ( remoteSiteId ) =>
		ipcRendererInvoke( 'getHostingPhpVersion', remoteSiteId ),
	getLatestRewindId: ( remoteSiteId ) => ipcRendererInvoke( 'getLatestRewindId', remoteSiteId ),
	listRemoteFileTree: ( remoteSiteId, rewindId, treePath ) =>
		ipcRendererInvoke( 'listRemoteFileTree', remoteSiteId, rewindId, treePath ),
	pullSiteFromLive: ( siteId, remoteSiteId, options ) =>
		ipcRendererInvoke( 'pullSiteFromLive', siteId, remoteSiteId, options ),
	cancelSyncOperation: ( siteId, remoteSiteId ) =>
		ipcRendererSend( 'cancelSyncOperation', siteId, remoteSiteId ),
	getDirectorySize: ( id, subdir ) => ipcRendererInvoke( 'getDirectorySize', id, subdir ),
	getFileSize: ( id, filePath ) => ipcRendererInvoke( 'getFileSize', id, filePath ),
	getPathForFile: ( file ) => webUtils.getPathForFile( file ),
	readLocalMediaFile: ( path ) => ipcRendererInvoke( 'readLocalMediaFile', path ),
	clearWebviewCache: ( webContentsId ) => ipcRendererInvoke( 'clearWebviewCache', webContentsId ),
	getWebviewNavigationHistory: ( webContentsId ) =>
		ipcRendererInvoke( 'getWebviewNavigationHistory', webContentsId ),
	goToWebviewNavigationHistoryEntry: ( webContentsId, index ) =>
		ipcRendererInvoke( 'goToWebviewNavigationHistoryEntry', webContentsId, index ),
	isFullscreen: () => ipcRendererInvoke( 'isFullscreen' ),
	getGlobalAgentInstructions: () => ipcRendererInvoke( 'getGlobalAgentInstructions' ),
	saveGlobalAgentInstructions: ( content, options ) =>
		ipcRendererInvoke( 'saveGlobalAgentInstructions', content, options ),
	getAiSettings: () => ipcRendererInvoke( 'getAiSettings' ),
	saveAnthropicApiKey: ( key ) => ipcRendererInvoke( 'saveAnthropicApiKey', key ),
	saveWapuuScore: ( score ) => ipcRendererInvoke( 'saveWapuuScore', score ),
	getWapuuScore: () => ipcRendererInvoke( 'getWapuuScore' ),
	getUserPreferences: () => ipcRendererInvoke( 'getUserPreferences' ),
	setUserPreferences: ( patch ) => ipcRendererInvoke( 'setUserPreferences', patch ),
	getOnboardingHints: () => ipcRendererInvoke( 'getOnboardingHints' ),
	saveOnboardingHints: ( partial ) => ipcRendererInvoke( 'saveOnboardingHints', partial ),
	comparePaths: ( path1, path2 ) => ipcRendererInvoke( 'comparePaths', path1, path2 ),
	listLocalFileTree: ( siteId, path, maxDepth ) =>
		ipcRenderer.invoke( 'listLocalFileTree', siteId, path, maxDepth ),
	readBlueprintFile: ( filePath ) => ipcRendererInvoke( 'readBlueprintFile', filePath ),
	extractBlueprintBundle: ( zipFilePath ) =>
		ipcRendererInvoke( 'extractBlueprintBundle', zipFilePath ),
	cleanupBlueprintTempDir: ( tempDir ) => ipcRendererInvoke( 'cleanupBlueprintTempDir', tempDir ),
	showTextContextMenu: ( context ) => ipcRendererInvoke( 'showTextContextMenu', context ),
	setTitleBarBackdropEffect: ( enabled ) =>
		ipcRendererInvoke( 'setTitleBarBackdropEffect', enabled ),
	setWindowControlsSurface: ( surface ) => ipcRendererInvoke( 'setWindowControlsSurface', surface ),
	updateSitesSortOrder: ( updates ) => ipcRendererInvoke( 'updateSitesSortOrder', updates ),
	isStudioCliInstalled: () => ipcRendererInvoke( 'isStudioCliInstalled' ),
	isStudioCliExternallyManaged: () => ipcRendererInvoke( 'isStudioCliExternallyManaged' ),
	installStudioCli: () => ipcRendererInvoke( 'installStudioCli' ),
	uninstallStudioCli: () => ipcRendererInvoke( 'uninstallStudioCli' ),
	getWordPressSkillsStatusAllSites: () => ipcRendererInvoke( 'getWordPressSkillsStatusAllSites' ),
	installWordPressSkillsToAllSites: ( options ) =>
		ipcRendererInvoke( 'installWordPressSkillsToAllSites', options ),
	removeWordPressSkillFromAllSites: ( skillId ) =>
		ipcRendererInvoke( 'removeWordPressSkillFromAllSites', skillId ),
	recordAnalyticsEvent: ( eventName, props ) =>
		ipcRendererInvoke( 'recordAnalyticsEvent', eventName, props ),
	listAiSessions: () => ipcRendererInvoke( 'listAiSessions' ),
	loadAiSession: ( sessionIdOrPrefix ) => ipcRendererInvoke( 'loadAiSession', sessionIdOrPrefix ),
	createAiSession: ( siteId ) => ipcRendererInvoke( 'createAiSession', siteId ),
	updateAiSessionMetadata: ( sessionIdOrPrefix, patch ) =>
		ipcRendererInvoke( 'updateAiSessionMetadata', sessionIdOrPrefix, patch ),
	continueAiSession: ( sessionId, prompt, options ) =>
		ipcRendererInvoke( 'continueAiSession', sessionId, prompt, options ),
	listActiveAiAgentRuns: () => ipcRendererInvoke( 'listActiveAiAgentRuns' ),
	setAiSessionModel: ( sessionId, model ) =>
		ipcRendererInvoke( 'setAiSessionModel', sessionId, model ),
	setAiSessionProvider: ( sessionId, provider, model ) =>
		ipcRendererInvoke( 'setAiSessionProvider', sessionId, provider, model ),
	interruptAiAgentRun: ( runId ) => ipcRendererInvoke( 'interruptAiAgentRun', runId ),
	answerAiAgentQuestion: ( runId, answers ) =>
		ipcRendererInvoke( 'answerAiAgentQuestion', runId, answers ),
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
