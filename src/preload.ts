// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import '@sentry/electron/preload';
import {
	IpcRendererEvent,
	SaveDialogOptions,
	contextBridge,
	ipcRenderer,
	webUtils,
} from 'electron';
import { LocaleData } from '@wordpress/i18n';
import { IpcEvents } from 'src/ipc-utils';
import { ExportOptions } from 'src/lib/import-export/export/types';
import { BackupArchiveInfo } from 'src/lib/import-export/import/types';
import { promptWindowsSpeedUpSites } from 'src/lib/windows-helpers';
import { SupportedEditor } from './lib/editor';
import type { SyncSite } from 'src/hooks/use-fetch-wpcom-sites/types';
import type { LogLevel } from 'src/logging';

const api: IpcApi = {
	archiveSite: ( id: string, format: 'zip' | 'tar' ) =>
		ipcRenderer.invoke( 'archiveSite', id, format ),
	exportSiteToPush: ( id: string ) => ipcRenderer.invoke( 'exportSiteToPush', id ),
	deleteSite: ( id: string, deleteFiles?: boolean ) =>
		ipcRenderer.invoke( 'deleteSite', id, deleteFiles ),
	createSite: (
		path: string,
		name?: string,
		wpVersion?: string,
		customDomain?: string,
		enableHttps?: boolean
	) => ipcRenderer.invoke( 'createSite', path, name, wpVersion, customDomain, enableHttps ),
	updateSite: ( updatedSite: SiteDetails ) => ipcRenderer.invoke( 'updateSite', updatedSite ),
	connectWpcomSites: ( ...args ) => ipcRenderer.invoke( 'connectWpcomSites', ...args ),
	disconnectWpcomSites: ( ...args ) => ipcRenderer.invoke( 'disconnectWpcomSites', ...args ),
	updateConnectedWpcomSites: ( ...args ) =>
		ipcRenderer.invoke( 'updateConnectedWpcomSites', ...args ),
	updateSingleConnectedWpcomSite: ( updatedSite: SyncSite ) =>
		ipcRenderer.invoke( 'updateSingleConnectedWpcomSite', updatedSite ),
	authenticate: () => ipcRenderer.invoke( 'authenticate' ),
	exportSite: ( options: ExportOptions, siteId: string ) =>
		ipcRenderer.invoke( 'exportSite', options, siteId ),
	isAuthenticated: () => ipcRenderer.invoke( 'isAuthenticated' ),
	getAuthenticationToken: () => ipcRenderer.invoke( 'getAuthenticationToken' ),
	clearAuthenticationToken: () => ipcRenderer.invoke( 'clearAuthenticationToken' ),
	saveSnapshotsToStorage: ( snapshots: Snapshot[] ) =>
		ipcRenderer.invoke( 'saveSnapshotsToStorage', snapshots ),
	getSnapshots: () => ipcRenderer.invoke( 'getSnapshots' ),
	getLastSeenVersion: () => ipcRenderer.invoke( 'getLastSeenVersion' ),
	saveLastSeenVersion: ( version: string ) => ipcRenderer.invoke( 'saveLastSeenVersion', version ),
	getSiteDetails: () => ipcRenderer.invoke( 'getSiteDetails' ),
	openSiteURL: (
		id: string,
		relativeURL = '',
		{ autoLogin = true }: { autoLogin?: boolean } = {}
	) => ipcRenderer.invoke( 'openSiteURL', id, relativeURL, { autoLogin } ),
	openURL: ( url: string ) => ipcRenderer.invoke( 'openURL', url ),
	showOpenFolderDialog: ( title: string, defaultDialogPath: string ) =>
		ipcRenderer.invoke( 'showOpenFolderDialog', title, defaultDialogPath ),
	showSaveAsDialog: ( options: SaveDialogOptions ) =>
		ipcRenderer.invoke( 'showSaveAsDialog', options ),
	saveUserLocale: ( locale: string ) => ipcRenderer.invoke( 'saveUserLocale', locale ),
	getSentryUserId: () => ipcRenderer.invoke( 'getSentryUserId' ),
	getUserLocale: () => ipcRenderer.invoke( 'getUserLocale' ),
	showUserSettings: () => ipcRenderer.invoke( 'showUserSettings' ),
	startServer: ( id: string ) => ipcRenderer.invoke( 'startServer', id ),
	stopServer: ( id: string ) => ipcRenderer.invoke( 'stopServer', id ),
	copyText: ( text: string ) => ipcRenderer.invoke( 'copyText', text ),
	getAppGlobals: () => ipcRenderer.invoke( 'getAppGlobals' ),
	removeTemporalFile: ( path: string ) => ipcRenderer.invoke( 'removeTemporalFile', path ),
	getWpVersion: ( id: string ) => ipcRenderer.invoke( 'getWpVersion', id ),
	generateProposedSitePath: ( siteName: string ) =>
		ipcRenderer.invoke( 'generateProposedSitePath', siteName ),
	openLocalPath: ( path: string ) => ipcRenderer.invoke( 'openLocalPath', path ),
	showItemInFolder: ( path: string ) => ipcRenderer.invoke( 'showItemInFolder', path ),
	getThemeDetails: ( id: string ) => ipcRenderer.invoke( 'getThemeDetails', id ),
	getThumbnailData: ( id: string ) => ipcRenderer.invoke( 'getThumbnailData', id ),
	getInstalledApps: () => ipcRenderer.invoke( 'getInstalledApps' ),
	importSite: ( { id, backupFile }: { id: string; backupFile: BackupArchiveInfo } ) =>
		ipcRenderer.invoke( 'importSite', { id, backupFile } ),
	executeWPCLiInline: ( options: { siteId: string; args: string } ) =>
		ipcRenderer.invoke( 'executeWPCLiInline', options ),
	getOnboardingData: () => ipcRenderer.invoke( 'getOnboardingData' ),
	saveOnboarding: ( onboardingCompleted: boolean ) =>
		ipcRenderer.invoke( 'saveOnboarding', onboardingCompleted ),
	openTerminalAtPath: ( targetPath: string, extraParams: { wpCliEnabled?: boolean } = {} ) =>
		ipcRenderer.invoke( 'openTerminalAtPath', targetPath, extraParams ),
	showMessageBox: ( options: Electron.MessageBoxOptions ) =>
		ipcRenderer.invoke( 'showMessageBox', options ),
	showErrorMessageBox: ( options: { title: string; message: string; error?: unknown } ) =>
		ipcRenderer.invoke( 'showErrorMessageBox', options ),
	showNotification: ( options: Electron.NotificationConstructorOptions ) =>
		ipcRenderer.invoke( 'showNotification', options ),
	// Use .send instead of .invoke because logging is fire-and-forget
	logRendererMessage: ( level: LogLevel, ...args: any[] ) =>
		ipcRenderer.send( 'logRendererMessage', level, ...args ),
	setupAppMenu: ( config: { needsOnboarding: boolean } ) =>
		ipcRenderer.invoke( 'setupAppMenu', config ),
	popupAppMenu: () => ipcRenderer.invoke( 'popupAppMenu' ),
	openCertificate: () => ipcRenderer.invoke( 'openCertificate' ),
	promptWindowsSpeedUpSites: ( ...args: Parameters< typeof promptWindowsSpeedUpSites > ) =>
		ipcRenderer.invoke( 'promptWindowsSpeedUpSites', ...args ),
	setDefaultLocaleData: ( locale?: LocaleData ) =>
		ipcRenderer.invoke( 'setDefaultLocaleData', locale ),
	resetDefaultLocaleData: () => ipcRenderer.invoke( 'resetDefaultLocaleData' ),
	toggleMinWindowWidth: ( isSidebarVisible: boolean ) =>
		ipcRenderer.invoke( 'toggleMinWindowWidth', isSidebarVisible ),
	getAbsolutePathFromSite: ( siteId: string, relativePath: string ) =>
		ipcRenderer.invoke( 'getAbsolutePathFromSite', siteId, relativePath ),
	openFileInIDE: ( relativePath: string, siteId: string ) =>
		ipcRenderer.invoke( 'openFileInIDE', relativePath, siteId ),
	isImportExportSupported: ( siteId: string ) =>
		ipcRenderer.invoke( 'isImportExportSupported', siteId ),
	checkSyncBackupSize: ( downloadUrl: string ) =>
		ipcRenderer.invoke( 'checkSyncBackupSize', downloadUrl ),
	downloadSyncBackup: ( remoteSiteId: number, downloadUrl: string ) =>
		ipcRenderer.invoke( 'downloadSyncBackup', remoteSiteId, downloadUrl ),
	removeSyncBackup: ( remoteSiteId: number ) =>
		ipcRenderer.invoke( 'removeSyncBackup', remoteSiteId ),
	getConnectedWpcomSites: ( localSiteId?: string ) =>
		ipcRenderer.invoke( 'getConnectedWpcomSites', localSiteId ),
	addSyncOperation: ( id: string ) => ipcRenderer.invoke( 'addSyncOperation', id ),
	clearSyncOperation: ( id: string ) => ipcRenderer.invoke( 'clearSyncOperation', id ),
	getWpContentSize: ( id: string ) => ipcRenderer.invoke( 'getWpContentSize', id ),
	getPathForFile: webUtils.getPathForFile,
	getFileContent: ( filePath: string ) => ipcRenderer.invoke( 'getFileContent', filePath ),
	isFullscreen: () => ipcRenderer.invoke( 'isFullscreen' ),
	getAllCustomDomains: () => ipcRenderer.invoke( 'getAllCustomDomains' ),
	getUserEditor: () => ipcRenderer.invoke( 'getUserEditor' ),
	saveUserEditor: ( editor: SupportedEditor ) => ipcRenderer.invoke( 'saveUserEditor', editor ),
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
