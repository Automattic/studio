// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import '@sentry/electron/preload';
import { SaveDialogOptions, contextBridge, ipcRenderer } from 'electron';
import { LocaleData } from '@wordpress/i18n';
import { ExportOptions } from './lib/import-export/export/types';
import { BackupArchiveInfo } from './lib/import-export/import/types';
import { promptWindowsSpeedUpSites } from './lib/windows-helpers';
import type { LogLevel } from './logging';

const api: IpcApi = {
	archiveSite: ( id: string ) => ipcRenderer.invoke( 'archiveSite', id ),
	deleteSite: ( id: string, deleteFiles?: boolean ) =>
		ipcRenderer.invoke( 'deleteSite', id, deleteFiles ),
	createSite: ( path: string, name?: string ) => ipcRenderer.invoke( 'createSite', path, name ),
	updateSite: ( updatedSite: SiteDetails ) => ipcRenderer.invoke( 'updateSite', updatedSite ),
	authenticate: () => ipcRenderer.invoke( 'authenticate' ),
	exportSite: ( options: ExportOptions, siteId: string ) =>
		ipcRenderer.invoke( 'exportSite', options, siteId ),
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
	showSaveAsDialog: ( options: SaveDialogOptions ) =>
		ipcRenderer.invoke( 'showSaveAsDialog', options ),
	saveUserLocale: ( locale: string ) => ipcRenderer.invoke( 'saveUserLocale', locale ),
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
	showNotification: ( options: Electron.NotificationConstructorOptions ) =>
		ipcRenderer.invoke( 'showNotification', options ),
	// Use .send instead of .invoke because logging is fire-and-forget
	logRendererMessage: ( level: LogLevel, ...args: any[] ) =>
		ipcRenderer.send( 'logRendererMessage', level, ...args ),
	setupAppMenu: () => ipcRenderer.invoke( 'setupAppMenu' ),
	popupAppMenu: () => ipcRenderer.invoke( 'popupAppMenu' ),
	promptWindowsSpeedUpSites: ( ...args: Parameters< typeof promptWindowsSpeedUpSites > ) =>
		ipcRenderer.invoke( 'promptWindowsSpeedUpSites', ...args ),
	setDefaultLocaleData: ( locale?: LocaleData ) =>
		ipcRenderer.invoke( 'setDefaultLocaleData', locale ),
	resetDefaultLocaleData: () => ipcRenderer.invoke( 'resetDefaultLocaleData' ),
	toggleMinWindowWidth: ( isSidebarVisible: boolean ) =>
		ipcRenderer.invoke( 'toggleMinWindowWidth', isSidebarVisible ),
};

contextBridge.exposeInMainWorld( 'ipcApi', api );

const allowedChannels = [
	'test-render-failure',
	'add-site',
	'user-settings',
	'auth-updated',
	'thumbnail-changed',
	'theme-details-changed',
	'theme-details-updating',
	'on-import',
	'on-export',
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
