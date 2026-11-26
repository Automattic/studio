// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import '@sentry/electron/preload';
import { IpcRendererEvent, contextBridge, ipcRenderer, webUtils } from 'electron';
import { isRemoteModeEnabled } from '@studio/common/lib/remote-mode-flag';
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
	remoteModeEnabled: isRemoteModeEnabled(),
	deleteSite: ( id, deleteFiles ) => ipcRendererInvoke( 'deleteSite', id, deleteFiles ),
	copySite: ( sourceSiteId, newSiteId, siteName ) =>
		ipcRendererInvoke( 'copySite', sourceSiteId, newSiteId, siteName ),
	createSite: ( path, config ) => ipcRendererInvoke( 'createSite', path, config ),
	updateSite: ( updatedSite, wpVersion ) =>
		ipcRendererInvoke( 'updateSite', updatedSite, wpVersion ),
	authenticate: ( isSignup, source, analytics ) =>
		ipcRendererInvoke( 'authenticate', isSignup, source, analytics ),
	exportSite: ( site, destinationPath, options ) =>
		ipcRendererInvoke( 'exportSite', site, destinationPath, options ),
	getAuthenticationToken: () => ipcRendererInvoke( 'getAuthenticationToken' ),
	clearAuthenticationToken: () => ipcRendererInvoke( 'clearAuthenticationToken' ),
	fetchSnapshots: () => ipcRendererInvoke( 'fetchSnapshots' ),
	publishPreviewSite: ( siteFolder, hostname, name, liveSite ) =>
		ipcRendererInvoke( 'publishPreviewSite', siteFolder, hostname, name, liveSite ),
	deletePreviewSite: ( hostname ) => ipcRendererInvoke( 'deletePreviewSite', hostname ),
	renamePreviewSite: ( hostname, name ) => ipcRendererInvoke( 'renamePreviewSite', hostname, name ),
	getSitePublishStatus: ( siteId, remoteSiteId, provider ) =>
		ipcRendererInvoke( 'getSitePublishStatus', siteId, remoteSiteId, provider ),
	getPreviewStatus: ( hostname ) => ipcRendererInvoke( 'getPreviewStatus', hostname ),
	deleteAllSnapshots: () => ipcRendererInvoke( 'deleteAllSnapshots' ),
	getSiteDetails: () => ipcRendererInvoke( 'getSiteDetails' ),
	setSiteFrontendAdminBar: ( siteId, hidden ) =>
		ipcRendererInvoke( 'setSiteFrontendAdminBar', siteId, hidden ),
	openSiteURL: ( id, relativeURL = '', { autoLogin = true } = {} ) =>
		ipcRendererSend( 'openSiteURL', id, relativeURL, { autoLogin } ),
	openURL: ( url ) => ipcRendererSend( 'openURL', url ),
	showOpenFolderDialog: ( title, defaultDialogPath, options ) =>
		ipcRendererInvoke( 'showOpenFolderDialog', title, defaultDialogPath, options ),
	isCATrusted: () => ipcRenderer.invoke( 'isCATrusted' ),
	trustCertificate: () => ipcRenderer.invoke( 'trustCertificate' ),
	showSaveAsDialog: ( options ) => ipcRendererInvoke( 'showSaveAsDialog', options ),
	startServer: ( id ) => ipcRendererInvoke( 'startServer', id ),
	stopServer: ( id ) => ipcRendererInvoke( 'stopServer', id ),
	copyText: ( text ) => ipcRendererInvoke( 'copyText', text ),
	getAppGlobals: () => ipcRendererInvoke( 'getAppGlobals' ),
	getAppUpdateStatus: () => ipcRendererInvoke( 'getAppUpdateStatus' ),
	checkForAppUpdates: () => ipcRendererInvoke( 'checkForAppUpdates' ),
	installAppUpdate: () => ipcRendererInvoke( 'installAppUpdate' ),
	getWpVersion: ( id ) => ipcRendererInvoke( 'getWpVersion', id ),
	getSiteDesign: ( id ) => ipcRendererInvoke( 'getSiteDesign', id ),
	fixSiteDesignDrift: ( id, fixes ) => ipcRendererInvoke( 'fixSiteDesignDrift', id, fixes ),
	getSiteEmails: ( id ) => ipcRendererInvoke( 'getSiteEmails', id ),
	openSiteEmailFolder: ( id ) => ipcRendererInvoke( 'openSiteEmailFolder', id ),
	getSiteEmail: ( id, emailId ) => ipcRendererInvoke( 'getSiteEmail', id, emailId ),
	getIsMultisite: ( id ) => ipcRendererInvoke( 'getIsMultisite', id ),
	generateProposedSitePath: ( siteName ) =>
		ipcRendererInvoke( 'generateProposedSitePath', siteName ),
	generateSiteNameFromList: ( usedSites ) =>
		ipcRendererInvoke( 'generateSiteNameFromList', usedSites ),
	generateNumberedNameFromList: ( baseName, usedSites ) =>
		ipcRendererInvoke( 'generateNumberedNameFromList', baseName, usedSites ),
	openLocalPath: ( path ) => ipcRendererSend( 'openLocalPath', path ),
	openStudioLogs: () => ipcRendererSend( 'openStudioLogs' ),
	getThumbnailData: ( id ) => ipcRendererInvoke( 'getThumbnailData', id ),
	captureAnnotationRegion: ( request ) => ipcRendererInvoke( 'captureAnnotationRegion', request ),
	captureSitePreview: ( siteId, guestId, pagePath ) =>
		ipcRendererInvoke( 'captureSitePreview', siteId, guestId, pagePath ),
	getInstalledAppsAndTerminals: () => ipcRendererInvoke( 'getInstalledAppsAndTerminals' ),
	getAgentApps: () => ipcRendererInvoke( 'getAgentApps' ),
	connectAgentApp: ( id ) => ipcRendererInvoke( 'connectAgentApp', id ),
	importSite: ( siteId, importArchivePath, options ) =>
		ipcRendererInvoke( 'importSite', siteId, importArchivePath, options ),
	getOnboardingData: () => ipcRendererInvoke( 'getOnboardingData' ),
	saveOnboarding: ( onboardingCompleted, analytics ) =>
		ipcRendererInvoke( 'saveOnboarding', onboardingCompleted, analytics ),
	openAppAtPath: ( editorKey, filePath, otherFiles?: string[] ) =>
		ipcRendererInvoke( 'openAppAtPath', editorKey, filePath, otherFiles ),
	openTerminalAtPath: ( targetPath ) => ipcRendererInvoke( 'openTerminalAtPath', targetPath ),
	showMessageBox: ( options ) => ipcRendererInvoke( 'showMessageBox', options ),
	showErrorMessageBox: ( options ) => ipcRendererSend( 'showErrorMessageBox', options ),
	setupAppMenu: () => ipcRendererInvoke( 'setupAppMenu' ),
	popupAppMenu: ( position ) => ipcRendererSend( 'popupAppMenu', position ),
	readyForDeeplinks: () => ipcRendererSend( 'readyForDeeplinks' ),
	getAbsolutePathFromSite: ( siteId, relativePath ) =>
		ipcRendererInvoke( 'getAbsolutePathFromSite', siteId, relativePath ),
	getSiteVisibility: ( provider, id ) => ipcRendererInvoke( 'getSiteVisibility', provider, id ),
	setSiteVisibility: ( provider, id, value ) =>
		ipcRendererInvoke( 'setSiteVisibility', provider, id, value ),
	getRemoteSites: ( provider, localSiteId ) =>
		ipcRendererInvoke( 'getRemoteSites', provider, localSiteId ),
	listAccountSites: ( provider ) => ipcRendererInvoke( 'listAccountSites', provider ),
	connectRemoteSite: ( provider, localSiteId, site ) =>
		ipcRendererInvoke( 'connectRemoteSite', provider, localSiteId, site ),
	resolveRemoteSite: ( provider, input ) =>
		ipcRendererInvoke( 'resolveRemoteSite', provider, input ),
	runSitesAction: ( provider, action, input ) =>
		ipcRendererInvoke( 'runSitesAction', provider, action, input ),
	disconnectRemoteSite: ( provider, localSiteId, remoteSiteId ) =>
		ipcRendererInvoke( 'disconnectRemoteSite', provider, localSiteId, remoteSiteId ),
	getSiteCreationVisibility: ( provider, input ) =>
		ipcRendererInvoke( 'getSiteCreationVisibility', provider, input ),
	createRemoteSite: ( provider, localSiteId, site, connect ) =>
		ipcRendererInvoke( 'createRemoteSite', provider, localSiteId, site, connect ),
	pushSite: ( provider, siteId, remoteSiteId, options ) =>
		ipcRendererInvoke( 'pushSite', provider, siteId, remoteSiteId, options ),
	pullSite: ( provider, siteId, remoteSiteId, options ) =>
		ipcRendererInvoke( 'pullSite', provider, siteId, remoteSiteId, options ),
	getRemoteBackupId: ( provider, remoteSiteId ) =>
		ipcRendererInvoke( 'getRemoteBackupId', provider, remoteSiteId ),
	listRemoteBackupFiles: ( provider, remoteSiteId, backupId, path ) =>
		ipcRendererInvoke( 'listRemoteBackupFiles', provider, remoteSiteId, backupId, path ),
	cancelSyncOperation: ( siteId, remoteSiteId ) =>
		ipcRendererSend( 'cancelSyncOperation', siteId, remoteSiteId ),
	getDirectorySize: ( id, subdir ) => ipcRendererInvoke( 'getDirectorySize', id, subdir ),
	getFileSize: ( id, filePath ) => ipcRendererInvoke( 'getFileSize', id, filePath ),
	getPathForFile: ( file ) => webUtils.getPathForFile( file ),
	readLocalMediaFile: ( path ) => ipcRendererInvoke( 'readLocalMediaFile', path ),
	openWebviewDevTools: ( webContentsId ) =>
		ipcRendererInvoke( 'openWebviewDevTools', webContentsId ),
	setWebviewColorScheme: ( webContentsId, colorScheme ) =>
		ipcRendererInvoke( 'setWebviewColorScheme', webContentsId, colorScheme ),
	clearWebviewBrowsingData: ( webContentsId ) =>
		ipcRendererInvoke( 'clearWebviewBrowsingData', webContentsId ),
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
	connectAiProvider: ( provider, method, input ) =>
		ipcRendererInvoke( 'connectAiProvider', provider, method, input ),
	disconnectAiProvider: ( provider ) => ipcRendererInvoke( 'disconnectAiProvider', provider ),
	listAiProviderModels: ( provider ) => ipcRendererInvoke( 'listAiProviderModels', provider ),
	selectAiProviderModels: ( provider, models ) =>
		ipcRendererInvoke( 'selectAiProviderModels', provider, models ),
	startProviderConnect: ( provider, method ) =>
		ipcRendererInvoke( 'startProviderConnect', provider, method ),
	setAiProvider: ( provider ) => ipcRendererInvoke( 'setAiProvider', provider ),
	setImageProvider: ( provider ) => ipcRendererInvoke( 'setImageProvider', provider ),
	saveWapuuScore: ( score ) => ipcRendererInvoke( 'saveWapuuScore', score ),
	getWapuuScore: () => ipcRendererInvoke( 'getWapuuScore' ),
	getUserPreferences: () => ipcRendererInvoke( 'getUserPreferences' ),
	setUserPreferences: ( patch ) => ipcRendererInvoke( 'setUserPreferences', patch ),
	getOnboardingHints: () => ipcRendererInvoke( 'getOnboardingHints' ),
	saveOnboardingHints: ( partial ) => ipcRendererInvoke( 'saveOnboardingHints', partial ),
	comparePaths: ( path1, path2 ) => ipcRendererInvoke( 'comparePaths', path1, path2 ),
	listLocalFileTree: ( siteId, path, maxDepth ) =>
		ipcRenderer.invoke( 'listLocalFileTree', siteId, path, maxDepth ),
	readBlueprint: ( source ) => ipcRendererInvoke( 'readBlueprint', source ),
	showTextContextMenu: ( context ) => ipcRendererInvoke( 'showTextContextMenu', context ),
	setWindowControlsSurface: ( surface ) => ipcRendererInvoke( 'setWindowControlsSurface', surface ),
	updateSitesSortOrder: ( updates ) => ipcRendererInvoke( 'updateSitesSortOrder', updates ),
	isStudioCliInstalled: () => ipcRendererInvoke( 'isStudioCliInstalled' ),
	isStudioCliExternallyManaged: () => ipcRendererInvoke( 'isStudioCliExternallyManaged' ),
	installStudioCli: () => ipcRendererInvoke( 'installStudioCli' ),
	uninstallStudioCli: () => ipcRendererInvoke( 'uninstallStudioCli' ),
	getPhoneAccess: () => ipcRendererInvoke( 'getPhoneAccess' ),
	setPhoneAccess: ( on ) => ipcRendererInvoke( 'setPhoneAccess', on ),
	getPhoneConnections: () => ipcRendererInvoke( 'getPhoneConnections' ),
	setPhoneConnection: ( request ) => ipcRendererInvoke( 'setPhoneConnection', request ),
	getPhonePairingCode: () => ipcRendererInvoke( 'getPhonePairingCode' ),
	getPairedPhones: () => ipcRendererInvoke( 'getPairedPhones' ),
	removePairedPhone: ( id ) => ipcRendererInvoke( 'removePairedPhone', id ),
	getGlobalSkills: () => ipcRendererInvoke( 'getGlobalSkills' ),
	setGlobalSkillEnabled: ( source, id, enabled ) =>
		ipcRendererInvoke( 'setGlobalSkillEnabled', source, id, enabled ),
	removeGlobalSkill: ( id ) => ipcRendererInvoke( 'removeGlobalSkill', id ),
	openGlobalSkill: ( source, id ) => ipcRendererInvoke( 'openGlobalSkill', source, id ),
	createSkill: ( siteId, draft ) => ipcRendererInvoke( 'createSkill', siteId, draft ),
	getSkill: ( siteId, id ) => ipcRendererInvoke( 'getSkill', siteId, id ),
	updateSkill: ( siteId, id, draft ) => ipcRendererInvoke( 'updateSkill', siteId, id, draft ),
	getSiteAgentFiles: ( siteId, kind ) => ipcRendererInvoke( 'getSiteAgentFiles', siteId, kind ),
	setSiteAgentFileEnabled: ( siteId, kind, id, enabled ) =>
		ipcRendererInvoke( 'setSiteAgentFileEnabled', siteId, kind, id, enabled ),
	removeSiteAgentFile: ( siteId, kind, id ) =>
		ipcRendererInvoke( 'removeSiteAgentFile', siteId, kind, id ),
	getGlobalInstructionsEnabled: () => ipcRendererInvoke( 'getGlobalInstructionsEnabled' ),
	setGlobalInstructionsEnabled: ( enabled ) =>
		ipcRendererInvoke( 'setGlobalInstructionsEnabled', enabled ),
	recordAnalyticsEvent: ( eventName, props, siteId ) =>
		ipcRendererInvoke( 'recordAnalyticsEvent', eventName, props, siteId ),
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
	setAiSessionThinking: ( sessionId, model, thinking ) =>
		ipcRendererInvoke( 'setAiSessionThinking', sessionId, model, thinking ),
	setAiSessionEnvironment: ( sessionId, environment ) =>
		ipcRendererInvoke( 'setAiSessionEnvironment', sessionId, environment ),
	interruptAiAgentRun: ( runId ) => ipcRendererInvoke( 'interruptAiAgentRun', runId ),
	answerAiAgentQuestion: ( runId, answers ) =>
		ipcRendererInvoke( 'answerAiAgentQuestion', runId, answers ),
	sendFeedback: ( feedback ) => ipcRendererInvoke( 'sendFeedback', feedback ),
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
