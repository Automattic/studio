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
	pushArchive: (
		selectedSiteId,
		remoteSiteId,
		archivePath,
		optionsToSync,
		specificSelectionPaths
	) =>
		ipcRendererInvoke(
			'pushArchive',
			selectedSiteId,
			remoteSiteId,
			archivePath,
			optionsToSync,
			specificSelectionPaths
		),
	pushSiteToLive: ( selectedSiteId, remoteSiteId ) =>
		ipcRendererInvoke( 'pushSiteToLive', selectedSiteId, remoteSiteId ),
	deleteSite: ( id, deleteFiles ) => ipcRendererInvoke( 'deleteSite', id, deleteFiles ),
	copySite: ( sourceSiteId, newSiteId, siteName ) =>
		ipcRendererInvoke( 'copySite', sourceSiteId, newSiteId, siteName ),
	createSite: ( path, config ) => ipcRendererInvoke( 'createSite', path, config ),
	updateSite: ( updatedSite, wpVersion ) =>
		ipcRendererInvoke( 'updateSite', updatedSite, wpVersion ),
	connectWpcomSites: ( ...args ) => ipcRendererInvoke( 'connectWpcomSites', ...args ),
	disconnectWpcomSites: ( ...args ) => ipcRendererInvoke( 'disconnectWpcomSites', ...args ),
	updateConnectedWpcomSites: ( ...args ) =>
		ipcRendererInvoke( 'updateConnectedWpcomSites', ...args ),
	authenticate: ( isSignup ) => ipcRendererSend( 'authenticate', isSignup ),
	exportSite: ( site, destinationPath, options ) =>
		ipcRendererInvoke( 'exportSite', site, destinationPath, options ),
	isAuthenticated: () => ipcRendererInvoke( 'isAuthenticated' ),
	getAuthenticationToken: () => ipcRendererInvoke( 'getAuthenticationToken' ),
	clearAuthenticationToken: () => ipcRendererInvoke( 'clearAuthenticationToken' ),
	fetchSnapshots: () => ipcRendererInvoke( 'fetchSnapshots' ),
	createSnapshot: ( siteFolder, name ) => ipcRendererInvoke( 'createSnapshot', siteFolder, name ),
	updateSnapshot: ( siteFolder, hostname ) =>
		ipcRendererInvoke( 'updateSnapshot', siteFolder, hostname ),
	deleteSnapshot: ( hostname ) => ipcRendererInvoke( 'deleteSnapshot', hostname ),
	deleteAllSnapshots: () => ipcRendererInvoke( 'deleteAllSnapshots' ),
	setSnapshot: ( hostname, options ) => ipcRendererInvoke( 'setSnapshot', hostname, options ),
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
	getDefaultSiteDirectory: () => ipcRendererInvoke( 'getDefaultSiteDirectory' ),
	saveDefaultSiteDirectory: ( directory ) =>
		ipcRendererInvoke( 'saveDefaultSiteDirectory', directory ),
	showUserSettings: ( tabName ) => ipcRendererInvoke( 'showUserSettings', tabName ),
	startServer: ( id ) => ipcRendererInvoke( 'startServer', id ),
	stopServer: ( id ) => ipcRendererInvoke( 'stopServer', id ),
	stopAllServers: () => ipcRendererInvoke( 'stopAllServers' ),
	copyText: ( text ) => ipcRendererInvoke( 'copyText', text ),
	getAppGlobals: () => ipcRendererInvoke( 'getAppGlobals' ),
	enableAgenticUi: () => ipcRendererInvoke( 'enableAgenticUi' ),
	disableAgenticUi: () => ipcRendererInvoke( 'disableAgenticUi' ),
	dismissAgenticUiBanner: () => ipcRendererInvoke( 'dismissAgenticUiBanner' ),
	isAgenticUiBannerDismissed: () => ipcRendererInvoke( 'isAgenticUiBannerDismissed' ),
	getAppUpdateStatus: () => ipcRendererInvoke( 'getAppUpdateStatus' ),
	installAppUpdate: () => ipcRendererInvoke( 'installAppUpdate' ),
	getWpVersion: ( id ) => ipcRendererInvoke( 'getWpVersion', id ),
	getIsMultisite: ( id ) => ipcRendererInvoke( 'getIsMultisite', id ),
	generateProposedSitePath: ( siteName ) =>
		ipcRendererInvoke( 'generateProposedSitePath', siteName ),
	generateSiteNameFromList: ( usedSites ) =>
		ipcRendererInvoke( 'generateSiteNameFromList', usedSites ),
	generateNumberedNameFromList: ( baseName, usedSites ) =>
		ipcRendererInvoke( 'generateNumberedNameFromList', baseName, usedSites ),
	openLocalPath: ( path ) => ipcRendererSend( 'openLocalPath', path ),
	showItemInFolder: ( path ) => ipcRendererSend( 'showItemInFolder', path ),
	loadThemeDetails: ( id, emitLoadingEvent = true ) =>
		ipcRendererInvoke( 'loadThemeDetails', id, emitLoadingEvent ),
	loadSiteIcon: ( id ) => ipcRendererInvoke( 'loadSiteIcon', id ),
	getThumbnailData: ( id ) => ipcRendererInvoke( 'getThumbnailData', id ),
	getInstalledAppsAndTerminals: () => ipcRendererInvoke( 'getInstalledAppsAndTerminals' ),
	importSite: ( siteId, importArchivePath, options ) =>
		ipcRendererInvoke( 'importSite', siteId, importArchivePath, options ),
	executeWPCLiInline: ( options ) => ipcRendererInvoke( 'executeWPCLiInline', options ),
	getOnboardingData: () => ipcRendererInvoke( 'getOnboardingData' ),
	saveOnboarding: ( onboardingCompleted ) =>
		ipcRendererInvoke( 'saveOnboarding', onboardingCompleted ),
	getBetaFeatures: () => ipcRendererInvoke( 'getBetaFeatures' ),
	openAppAtPath: ( editorKey, filePath, otherFiles?: string[] ) =>
		ipcRendererInvoke( 'openAppAtPath', editorKey, filePath, otherFiles ),
	openTerminalAtPath: ( targetPath ) => ipcRendererInvoke( 'openTerminalAtPath', targetPath ),
	showMessageBox: ( options ) => ipcRendererInvoke( 'showMessageBox', options ),
	showErrorMessageBox: ( options ) => ipcRendererSend( 'showErrorMessageBox', options ),
	showNotification: ( options ) => ipcRendererSend( 'showNotification', options ),
	logRendererMessage: ( level, ...args ) => ipcRendererSend( 'logRendererMessage', level, ...args ),
	setupAppMenu: ( config ) => ipcRendererInvoke( 'setupAppMenu', config ),
	popupAppMenu: ( position ) => ipcRendererSend( 'popupAppMenu', position ),
	openCertificate: () => ipcRendererSend( 'openCertificate' ),
	promptWindowsSpeedUpSites: ( ...args ) =>
		ipcRendererInvoke( 'promptWindowsSpeedUpSites', ...args ),
	setDefaultLocaleData: ( locale ) => ipcRendererInvoke( 'setDefaultLocaleData', locale ),
	resetDefaultLocaleData: () => ipcRendererInvoke( 'resetDefaultLocaleData' ),
	toggleMinWindowWidth: ( isSidebarVisible, currentSidebarWidth? ) =>
		ipcRendererInvoke( 'toggleMinWindowWidth', isSidebarVisible, currentSidebarWidth ),
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
	fetchSyncableWpcomSites: () => ipcRendererInvoke( 'fetchSyncableWpcomSites' ),
	pullSiteFromLive: ( siteId, remoteSiteId ) =>
		ipcRendererInvoke( 'pullSiteFromLive', siteId, remoteSiteId ),
	addSyncOperation: ( id, status ) => ipcRendererSend( 'addSyncOperation', id, status ),
	clearSyncOperation: ( id ) => ipcRendererSend( 'clearSyncOperation', id ),
	cancelSyncOperation: ( id ) => ipcRendererSend( 'cancelSyncOperation', id ),
	pauseSyncUpload: ( selectedSiteId, remoteSiteId ) =>
		ipcRendererInvoke( 'pauseSyncUpload', selectedSiteId, remoteSiteId ),
	resumeSyncUpload: ( selectedSiteId, remoteSiteId ) =>
		ipcRendererInvoke( 'resumeSyncUpload', selectedSiteId, remoteSiteId ),
	getDirectorySize: ( id, subdir ) => ipcRendererInvoke( 'getDirectorySize', id, subdir ),
	getFileSize: ( id, filePath ) => ipcRendererInvoke( 'getFileSize', id, filePath ),
	getPathForFile: ( file ) => webUtils.getPathForFile( file ),
	readLocalMediaFile: ( path ) => ipcRendererInvoke( 'readLocalMediaFile', path ),
	isFullscreen: () => ipcRendererInvoke( 'isFullscreen' ),
	getAllCustomDomains: () => ipcRendererInvoke( 'getAllCustomDomains' ),
	saveUserTerminal: ( preferredTerminal ) =>
		ipcRendererInvoke( 'saveUserTerminal', preferredTerminal ),
	getUserTerminal: () => ipcRendererInvoke( 'getUserTerminal' ),
	getGlobalAgentInstructions: () => ipcRendererInvoke( 'getGlobalAgentInstructions' ),
	saveGlobalAgentInstructions: ( content ) =>
		ipcRendererInvoke( 'saveGlobalAgentInstructions', content ),
	previewColorScheme: ( colorScheme ) => ipcRendererInvoke( 'previewColorScheme', colorScheme ),
	saveColorScheme: ( colorScheme ) => ipcRendererInvoke( 'saveColorScheme', colorScheme ),
	getColorScheme: () => ipcRendererInvoke( 'getColorScheme' ),
	getAnalyticsEnabled: () => ipcRendererInvoke( 'getAnalyticsEnabled' ),
	saveAnalyticsEnabled: ( enabled ) => ipcRendererInvoke( 'saveAnalyticsEnabled', enabled ),
	saveQuitSitesBehavior: ( quitSitesBehavior ) =>
		ipcRendererInvoke( 'saveQuitSitesBehavior', quitSitesBehavior ),
	getQuitSitesBehavior: () => ipcRendererInvoke( 'getQuitSitesBehavior' ),
	saveAgenticFeaturesEnabled: ( enabled ) =>
		ipcRendererInvoke( 'saveAgenticFeaturesEnabled', enabled ),
	getAgenticFeaturesEnabled: () => ipcRendererInvoke( 'getAgenticFeaturesEnabled' ),
	saveWapuuScore: ( score ) => ipcRendererInvoke( 'saveWapuuScore', score ),
	getWapuuScore: () => ipcRendererInvoke( 'getWapuuScore' ),
	getUserEditor: () => ipcRendererInvoke( 'getUserEditor' ),
	saveUserEditor: ( editor ) => ipcRendererInvoke( 'saveUserEditor', editor ),
	comparePaths: ( path1, path2 ) => ipcRendererInvoke( 'comparePaths', path1, path2 ),
	listLocalFileTree: ( siteId, path, maxDepth ) =>
		ipcRenderer.invoke( 'listLocalFileTree', siteId, path, maxDepth ),
	validateBlueprint: ( blueprintJson ) => ipcRendererInvoke( 'validateBlueprint', blueprintJson ),
	readBlueprintFile: ( filePath ) => ipcRendererInvoke( 'readBlueprintFile', filePath ),
	extractBlueprintBundle: ( zipFilePath ) =>
		ipcRendererInvoke( 'extractBlueprintBundle', zipFilePath ),
	cleanupBlueprintTempDir: ( tempDir ) => ipcRendererInvoke( 'cleanupBlueprintTempDir', tempDir ),
	showSiteContextMenu: ( context ) => ipcRendererSend( 'showSiteContextMenu', context ),
	setPreviewAnnotationReady: ( ready ) => ipcRendererSend( 'setPreviewAnnotationReady', ready ),
	setWindowControlVisibility: ( visible ) =>
		ipcRendererInvoke( 'setWindowControlVisibility', visible ),
	setTitleBarBackdropEffect: ( enabled ) =>
		ipcRendererInvoke( 'setTitleBarBackdropEffect', enabled ),
	updateSitesSortOrder: ( updates ) => ipcRendererInvoke( 'updateSitesSortOrder', updates ),
	getRemoteSessionDaemonStatus: () => ipcRendererInvoke( 'getRemoteSessionDaemonStatus' ),
	startRemoteSessionDaemon: () => ipcRendererInvoke( 'startRemoteSessionDaemon' ),
	stopRemoteSessionDaemon: () => ipcRendererInvoke( 'stopRemoteSessionDaemon' ),
	isStudioCliInstalled: () => ipcRendererInvoke( 'isStudioCliInstalled' ),
	isStudioCliExternallyManaged: () => ipcRendererInvoke( 'isStudioCliExternallyManaged' ),
	installStudioCli: () => ipcRendererInvoke( 'installStudioCli' ),
	uninstallStudioCli: () => ipcRendererInvoke( 'uninstallStudioCli' ),
	getAgentInstructionsStatus: ( siteId ) =>
		ipcRendererInvoke( 'getAgentInstructionsStatus', siteId ),
	installAgentInstructions: ( siteId, options ) =>
		ipcRendererInvoke( 'installAgentInstructions', siteId, options ),
	removeAgentInstruction: ( siteId, fileType ) =>
		ipcRendererInvoke( 'removeAgentInstruction', siteId, fileType ),
	getWordPressSkillsStatus: ( siteId ) => ipcRendererInvoke( 'getWordPressSkillsStatus', siteId ),
	installWordPressSkills: ( siteId, options ) =>
		ipcRendererInvoke( 'installWordPressSkills', siteId, options ),
	installWordPressSkillById: ( siteId, skillId, options ) =>
		ipcRendererInvoke( 'installWordPressSkillById', siteId, skillId, options ),
	removeWordPressSkillById: ( siteId, skillId ) =>
		ipcRendererInvoke( 'removeWordPressSkillById', siteId, skillId ),
	getWordPressSkillsStatusAllSites: () => ipcRendererInvoke( 'getWordPressSkillsStatusAllSites' ),
	installWordPressSkillsToAllSites: ( options ) =>
		ipcRendererInvoke( 'installWordPressSkillsToAllSites', options ),
	removeWordPressSkillFromAllSites: ( skillId ) =>
		ipcRendererInvoke( 'removeWordPressSkillFromAllSites', skillId ),
	recordAnalyticsEvent: ( eventName, props ) =>
		ipcRendererInvoke( 'recordAnalyticsEvent', eventName, props ),
	listAiSessions: () => ipcRendererInvoke( 'listAiSessions' ),
	loadAiSession: ( sessionIdOrPrefix ) => ipcRendererInvoke( 'loadAiSession', sessionIdOrPrefix ),
	deleteAiSession: ( sessionIdOrPrefix ) =>
		ipcRendererInvoke( 'deleteAiSession', sessionIdOrPrefix ),
	createAiSession: ( siteId ) => ipcRendererInvoke( 'createAiSession', siteId ),
	updateAiSessionMetadata: ( sessionIdOrPrefix, patch ) =>
		ipcRendererInvoke( 'updateAiSessionMetadata', sessionIdOrPrefix, patch ),
	continueAiSession: ( sessionId, prompt, options ) =>
		ipcRendererInvoke( 'continueAiSession', sessionId, prompt, options ),
	markAiMessageEdited: ( sessionId, originalEntryId ) =>
		ipcRendererInvoke( 'markAiMessageEdited', sessionId, originalEntryId ),
	listActiveAiAgentRuns: () => ipcRendererInvoke( 'listActiveAiAgentRuns' ),
	setAiSessionModel: ( sessionId, model ) =>
		ipcRendererInvoke( 'setAiSessionModel', sessionId, model ),
	interruptAiAgentRun: ( runId ) => ipcRendererInvoke( 'interruptAiAgentRun', runId ),
	answerAiAgentQuestion: ( runId, answers ) =>
		ipcRendererInvoke( 'answerAiAgentQuestion', runId, answers ),
	setSessionEnvironment: ( sessionId, environment ) =>
		ipcRendererInvoke( 'setSessionEnvironment', sessionId, environment ),
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
