import { exec } from 'child_process';
import crypto from 'crypto';
import {
	BrowserWindow,
	app,
	clipboard,
	dialog,
	shell,
	type IpcMainInvokeEvent,
	Notification,
	SaveDialogOptions,
} from 'electron';
import fs from 'fs';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import { LocaleData, defaultI18n } from '@wordpress/i18n';
import archiver from 'archiver';
import { DEFAULT_PHP_VERSION } from '../vendor/wp-now/src/constants';
import { SIZE_LIMIT_BYTES } from './constants';
import { isEmptyDir, pathExists, isWordPressDirectory, sanitizeFolderName } from './lib/fs-utils';
import { getImageData } from './lib/get-image-data';
import { exportBackup } from './lib/import-export/export/export-manager';
import { ExportOptions } from './lib/import-export/export/types';
import { ImportExportEventData } from './lib/import-export/handle-events';
import { defaultImporterOptions, importBackup } from './lib/import-export/import/import-manager';
import { BackupArchiveInfo } from './lib/import-export/import/types';
import { isErrnoException } from './lib/is-errno-exception';
import { isInstalled } from './lib/is-installed';
import { SupportedLocale } from './lib/locale';
import { getUserLocaleWithFallback } from './lib/locale-node';
import * as oauthClient from './lib/oauth';
import { createPassword } from './lib/passwords';
import { phpGetThemeDetails } from './lib/php-get-theme-details';
import { sanitizeForLogging } from './lib/sanitize-for-logging';
import { sortSites } from './lib/sort-sites';
import { installSqliteIntegration, keepSqliteIntegrationUpdated } from './lib/sqlite-versions';
import * as windowsHelpers from './lib/windows-helpers';
import { writeLogToFile, type LogLevel } from './logging';
import { popupMenu, setupMenu } from './menu';
import { SiteServer, createSiteWorkingDirectory } from './site-server';
import { DEFAULT_SITE_PATH, getResourcesPath, getSiteThumbnailPath } from './storage/paths';
import { loadUserData, saveUserData } from './storage/user-data';
import type { WpCliResult } from './lib/wp-cli-process';

const TEMP_DIR = nodePath.join( app.getPath( 'temp' ), 'com.wordpress.studio' ) + nodePath.sep;
if ( ! fs.existsSync( TEMP_DIR ) ) {
	fs.mkdirSync( TEMP_DIR );
}

async function sendThumbnailChangedEvent( event: IpcMainInvokeEvent, id: string ) {
	if ( event.sender.isDestroyed() ) {
		return;
	}
	const thumbnailData = await getThumbnailData( event, id );
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( parentWindow && ! parentWindow.isDestroyed() ) {
		parentWindow.webContents.send( 'thumbnail-changed', id, thumbnailData );
	}
}

async function mergeSiteDetailsWithRunningDetails(
	sites: SiteDetails[]
): Promise< SiteDetails[] > {
	return sites.map( ( site ) => {
		const server = SiteServer.get( site.id );
		if ( server ) {
			return server.details;
		}
		return site;
	} );
}

export async function getSiteDetails( _event: IpcMainInvokeEvent ): Promise< SiteDetails[] > {
	const userData = await loadUserData();

	// This is probably one of the first times the user data is loaded. Take the opportunity
	// to log for debugging purposes.
	console.log( 'Loaded user data', sanitizeForLogging( userData ) );

	const { sites } = userData;

	// Ensure we have an instance of a server for each site we know about
	for ( const site of sites ) {
		if ( ! SiteServer.get( site.id ) && ! site.running ) {
			SiteServer.create( site );
		}
	}

	return mergeSiteDetailsWithRunningDetails( sites );
}

export async function getInstalledApps( _event: IpcMainInvokeEvent ): Promise< InstalledApps > {
	return {
		vscode: isInstalled( 'vscode' ),
		phpstorm: isInstalled( 'phpstorm' ),
	};
}

export async function importSite(
	event: IpcMainInvokeEvent,
	{ id, backupFile }: { id: string; backupFile: BackupArchiveInfo }
): Promise< SiteDetails | undefined > {
	const site = SiteServer.get( id );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	try {
		const onEvent = ( data: ImportExportEventData ) => {
			const parentWindow = BrowserWindow.fromWebContents( event.sender );
			if ( parentWindow && ! parentWindow.isDestroyed() && ! event.sender.isDestroyed() ) {
				parentWindow.webContents.send( 'on-import', data, id );
			}
		};
		const result = await importBackup( backupFile, site.details, onEvent, defaultImporterOptions );
		if ( ! result ) {
			return;
		}
		if ( result?.meta?.phpVersion ) {
			site.details.phpVersion = result.meta.phpVersion;
		}
		return site.details;
	} catch ( e ) {
		Sentry.captureException( e );
		throw e;
	}
}

export async function createSite(
	event: IpcMainInvokeEvent,
	path: string,
	siteName?: string
): Promise< SiteDetails[] > {
	const userData = await loadUserData();
	const forceSetupSqlite = false;
	// We only recursively create the directory if the user has not selected a
	// path from the dialog (and thus they use the "default" or suggested path).
	if ( ! ( await pathExists( path ) ) && path.startsWith( DEFAULT_SITE_PATH ) ) {
		fs.mkdirSync( path, { recursive: true } );
	}

	if ( ! ( await isEmptyDir( path ) ) && ! isWordPressDirectory( path ) ) {
		// Form validation should've prevented a non-empty directory from being selected
		throw new Error( 'The selected directory is not empty nor an existing WordPress site.' );
	}

	const allPaths = userData?.sites?.map( ( site ) => site.path ) || [];
	if ( allPaths.includes( path ) ) {
		return userData.sites;
	}

	if ( ( await pathExists( path ) ) && ( await isEmptyDir( path ) ) ) {
		try {
			await createSiteWorkingDirectory( path );
		} catch ( error ) {
			// If site creation failed, remove the generated files and re-throw the
			// error so it can be handled by the caller.
			shell.trashItem( path );
			throw error;
		}
	}

	const details = {
		id: crypto.randomUUID(),
		name: siteName || nodePath.basename( path ),
		path,
		adminPassword: createPassword(),
		running: false,
		phpVersion: DEFAULT_PHP_VERSION,
	} as const;

	const server = SiteServer.create( details );

	if ( isWordPressDirectory( path ) ) {
		// If the directory contains a WordPress installation, and user wants to force SQLite
		// integration, let's rename the wp-config.php file to allow WP Now to create a new one
		// and initialize things properly.
		if ( forceSetupSqlite && ( await pathExists( nodePath.join( path, 'wp-config.php' ) ) ) ) {
			fs.renameSync(
				nodePath.join( path, 'wp-config.php' ),
				nodePath.join( path, 'wp-config-studio.php' )
			);
		}

		if ( ! ( await pathExists( nodePath.join( path, 'wp-config.php' ) ) ) ) {
			await installSqliteIntegration( path );
		}
	}

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( parentWindow && ! parentWindow.isDestroyed() && ! event.sender.isDestroyed() ) {
		parentWindow.webContents.send( 'theme-details-updating', details.id );
	}

	userData.sites.push( server.details );
	sortSites( userData.sites );
	await saveUserData( userData );

	return mergeSiteDetailsWithRunningDetails( userData.sites );
}

export async function updateSite(
	event: IpcMainInvokeEvent,
	updatedSite: SiteDetails
): Promise< SiteDetails[] > {
	const userData = await loadUserData();
	const updatedSites = userData.sites.map( ( site ) =>
		site.id === updatedSite.id ? updatedSite : site
	);
	userData.sites = updatedSites;

	const server = SiteServer.get( updatedSite.id );
	if ( server ) {
		server.updateSiteDetails( updatedSite );
	}
	await saveUserData( userData );
	return mergeSiteDetailsWithRunningDetails( userData.sites );
}

export async function startServer(
	event: IpcMainInvokeEvent,
	id: string
): Promise< SiteDetails | null > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return null;
	}

	await keepSqliteIntegrationUpdated( server.details.path );

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	await server.start();
	if ( parentWindow && ! parentWindow.isDestroyed() && ! event.sender.isDestroyed() ) {
		parentWindow.webContents.send( 'theme-details-changed', id, server.details.themeDetails );
	}
	server.updateCachedThumbnail().then( () => sendThumbnailChangedEvent( event, id ) );

	console.log( 'Server started', server.details );
	await updateSite( event, server.details );
	return server.details;
}

export async function stopServer(
	event: IpcMainInvokeEvent,
	id: string
): Promise< SiteDetails | null > {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return null;
	}

	await server.stop();
	return server.details;
}

export interface FolderDialogResponse {
	path: string;
	name: string;
	isEmpty: boolean;
	isWordPress: boolean;
}

export async function showSaveAsDialog( event: IpcMainInvokeEvent, options: SaveDialogOptions ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow ) {
		throw new Error( `No window found for sender of showSaveAsDialog message: ${ event.frameId }` );
	}

	const defaultPath =
		options.defaultPath === nodePath.basename( options.defaultPath ?? '' )
			? nodePath.join( DEFAULT_SITE_PATH, options.defaultPath )
			: options.defaultPath;
	const { canceled, filePath } = await dialog.showSaveDialog( parentWindow, {
		defaultPath,
		...options,
	} );
	if ( canceled ) {
		return '';
	}
	return filePath;
}

export async function showOpenFolderDialog(
	event: IpcMainInvokeEvent,
	title: string
): Promise< FolderDialogResponse | null > {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow ) {
		throw new Error(
			`No window found for sender of showOpenFolderDialog message: ${ event.frameId }`
		);
	}

	if ( process.env.E2E && process.env.E2E_OPEN_FOLDER_DIALOG ) {
		// Playwright's filechooser event isn't working in our e2e tests.
		// Use an environment variable to manually set which folder gets selected.
		return {
			path: process.env.E2E_OPEN_FOLDER_DIALOG,
			name: nodePath.basename( process.env.E2E_OPEN_FOLDER_DIALOG ),
			isEmpty: await isEmptyDir( process.env.E2E_OPEN_FOLDER_DIALOG ),
			isWordPress: isWordPressDirectory( process.env.E2E_OPEN_FOLDER_DIALOG ),
		};
	}

	const { canceled, filePaths } = await dialog.showOpenDialog( parentWindow, {
		title,
		defaultPath: DEFAULT_SITE_PATH,
		properties: [
			'openDirectory',
			'createDirectory', // allow user to create new directories; macOS only
		],
	} );
	if ( canceled ) {
		return null;
	}

	return {
		path: filePaths[ 0 ],
		name: nodePath.basename( filePaths[ 0 ] ),
		isEmpty: await isEmptyDir( filePaths[ 0 ] ),
		isWordPress: isWordPressDirectory( filePaths[ 0 ] ),
	};
}

export async function saveUserLocale( _event: IpcMainInvokeEvent, locale: string ) {
	const userData = await loadUserData();
	await saveUserData( {
		...userData,
		locale,
	} );
}

export async function getUserLocale( _event: IpcMainInvokeEvent ): Promise< SupportedLocale > {
	return getUserLocaleWithFallback();
}

export async function showUserSettings( event: IpcMainInvokeEvent ): Promise< void > {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( ! parentWindow ) {
		throw new Error( `No window found for sender of showUserSettings message: ${ event.frameId }` );
	}
	parentWindow.webContents.send( 'user-settings' );
}

function zipWordPressDirectory( { source, zipPath }: { source: string; zipPath: string } ) {
	return new Promise( ( resolve, reject ) => {
		const output = fs.createWriteStream( zipPath );
		const archive = archiver( 'zip', {
			zlib: { level: 9 }, // Sets the compression level.
		} );

		output.on( 'close', function () {
			resolve( archive );
		} );

		archive.on( 'error', function ( err: Error ) {
			reject( err );
		} );

		archive.pipe( output );
		// Archive site wp-content
		archive.directory( `${ source }/wp-content`, 'wp-content' );
		archive.file( `${ source }/wp-config.php`, { name: 'wp-config.php' } );

		archive.finalize();
	} );
}

export async function archiveSite( event: IpcMainInvokeEvent, id: string ) {
	const site = SiteServer.get( id );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	const sitePath = site.details.path;
	const zipPath = `${ TEMP_DIR }site_${ id }.zip`;
	await zipWordPressDirectory( {
		source: sitePath,
		zipPath,
	} );
	const stats = fs.statSync( zipPath );
	const zipContent = fs.readFileSync( zipPath );
	return { zipPath, zipContent, exceedsSizeLimit: stats.size > SIZE_LIMIT_BYTES };
}

export function removeTemporalFile( event: IpcMainInvokeEvent, path: string ) {
	if ( ! path.includes( TEMP_DIR ) ) {
		throw new Error( 'The given path is not a temporal file' );
	}
	try {
		fs.unlinkSync( path );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			// Silently ignore if the temporal file doesn't exist
			Sentry.captureException( error );
		}
	}
}

export async function deleteSite( event: IpcMainInvokeEvent, id: string, deleteFiles = false ) {
	const server = SiteServer.get( id );
	console.log( 'Deleting site', id );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}
	const userData = await loadUserData();
	await server.delete();
	try {
		// Move files to trash
		if ( deleteFiles ) {
			await shell.trashItem( server.details.path );
		}
	} catch ( error ) {
		/* We want to exit gracefully if the there is an error deleting the site files */
		Sentry.captureException( error );
	}
	const newSites = userData.sites.filter( ( site ) => site.id !== id );
	const newUserData = { ...userData, sites: newSites };
	await saveUserData( newUserData );
	return mergeSiteDetailsWithRunningDetails( newSites );
}

export function logRendererMessage(
	event: IpcMainInvokeEvent,
	level: LogLevel,
	...args: unknown[]
): void {
	// 4 characters long so it aligns with the main process logs
	const processId = `ren${ event.sender.id }`;
	writeLogToFile( level, processId, ...args );
}

export async function authenticate( _event: IpcMainInvokeEvent ): Promise< void > {
	return oauthClient.authenticate();
}

export async function getAuthenticationToken(
	_event: IpcMainInvokeEvent
): Promise< oauthClient.StoredToken | null > {
	return oauthClient.getAuthenticationToken();
}

export async function isAuthenticated() {
	return oauthClient.isAuthenticated();
}

export async function clearAuthenticationToken() {
	return oauthClient.clearAuthenticationToken();
}

export async function exportSite(
	event: IpcMainInvokeEvent,
	options: ExportOptions,
	siteId: string
): Promise< boolean > {
	try {
		const onEvent = ( data: ImportExportEventData ) => {
			const parentWindow = BrowserWindow.fromWebContents( event.sender );
			if ( parentWindow && ! parentWindow.isDestroyed() && ! event.sender.isDestroyed() ) {
				parentWindow.webContents.send( 'on-export', data, siteId );
			}
		};
		return await exportBackup( options, onEvent );
	} catch ( e ) {
		Sentry.captureException( e );
		throw e;
	}
}

export async function saveSnapshotsToStorage( event: IpcMainInvokeEvent, snapshots: Snapshot[] ) {
	const userData = await loadUserData();
	await saveUserData( {
		...userData,
		snapshots: snapshots.map( ( { isLoading, ...restSnapshots } ) => restSnapshots ),
	} );
}

export async function getSnapshots( _event: IpcMainInvokeEvent ): Promise< Snapshot[] > {
	const userData = await loadUserData();
	const { snapshots = [] } = userData;
	return snapshots;
}

export async function openSiteURL( event: IpcMainInvokeEvent, id: string, relativeURL = '' ) {
	const site = SiteServer.get( id );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	shell.openExternal( site.server?.url + relativeURL );
}

export async function openURL( event: IpcMainInvokeEvent, url: string ) {
	return shell.openExternal( url );
}

export async function copyText( event: IpcMainInvokeEvent, text: string ) {
	return clipboard.writeText( text );
}

export async function getAppGlobals( _event: IpcMainInvokeEvent ): Promise< AppGlobals > {
	return {
		platform: process.platform,
		appName: app.name,
		arm64Translation: app.runningUnderARM64Translation,
		assistantEnabled: process.env.STUDIO_AI === 'true',
		terminalWpCliEnabled: process.env.STUDIO_TERMINAL_WP_CLI === 'true',
	};
}

export async function getWpVersion( _event: IpcMainInvokeEvent, id: string ) {
	const server = SiteServer.get( id );
	if ( ! server ) {
		return '-';
	}
	const wordPressPath = server.details.path;
	let versionFileContent = '';
	try {
		versionFileContent = fs.readFileSync(
			nodePath.join( wordPressPath, 'wp-includes', 'version.php' ),
			'utf8'
		);
	} catch ( err ) {
		return '-';
	}
	const matches = versionFileContent.match( /\$wp_version\s*=\s*'([0-9a-zA-Z.-]+)'/ );
	return matches?.[ 1 ] || '-';
}

export async function generateProposedSitePath(
	_event: IpcMainInvokeEvent,
	siteName: string
): Promise< FolderDialogResponse > {
	const path = nodePath.join( DEFAULT_SITE_PATH, sanitizeFolderName( siteName ) );

	try {
		return {
			path,
			name: siteName,
			isEmpty: await isEmptyDir( path ),
			isWordPress: isWordPressDirectory( path ),
		};
	} catch ( err ) {
		if ( isErrnoException( err ) && err.code === 'ENOENT' ) {
			return {
				path,
				name: siteName,
				isEmpty: true,
				isWordPress: false,
			};
		}
		throw err;
	}
}

export async function openLocalPath( _event: IpcMainInvokeEvent, path: string ) {
	shell.openPath( path );
}

export async function showItemInFolder( _event: IpcMainInvokeEvent, path: string ) {
	shell.showItemInFolder( path );
}

export async function getThemeDetails( event: IpcMainInvokeEvent, id: string ) {
	const server = SiteServer.get( id );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	if ( ! server.details.running || ! server.server ) {
		return null;
	}
	const themeDetails = await phpGetThemeDetails( server.server );

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( themeDetails?.path && themeDetails.path !== server.details.themeDetails?.path ) {
		if ( parentWindow && ! parentWindow.isDestroyed() && ! event.sender.isDestroyed() ) {
			parentWindow.webContents.send( 'theme-details-updating', id );
		}
		const updatedSite = {
			...server.details,
			themeDetails,
		};
		if ( parentWindow && ! parentWindow.isDestroyed() && ! event.sender.isDestroyed() ) {
			parentWindow.webContents.send( 'theme-details-changed', id, themeDetails );
		}

		server.updateCachedThumbnail().then( () => sendThumbnailChangedEvent( event, id ) );
		server.details.themeDetails = themeDetails;
		await updateSite( event, updatedSite );
	}
	return themeDetails;
}

export async function getOnboardingData( _event: IpcMainInvokeEvent ): Promise< boolean > {
	const userData = await loadUserData();
	const { onboardingCompleted = false } = userData;
	return onboardingCompleted;
}

export async function saveOnboarding(
	_event: IpcMainInvokeEvent,
	onboardingCompleted: boolean
): Promise< void > {
	const userData = await loadUserData();
	await saveUserData( {
		...userData,
		onboardingCompleted,
	} );
}

export async function executeWPCLiInline(
	_event: IpcMainInvokeEvent,
	{ siteId, args }: { siteId: string; args: string }
): Promise< WpCliResult > {
	if ( SiteServer.isDeleted( siteId ) ) {
		return {
			stdout: '',
			stderr: `Cannot execute command on deleted site ${ siteId }`,
			exitCode: 1,
		};
	}
	const server = SiteServer.get( siteId );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}
	return server.executeWpCliCommand( args );
}

export async function getThumbnailData( _event: IpcMainInvokeEvent, id: string ) {
	const path = getSiteThumbnailPath( id );
	return getImageData( path );
}

export function openTerminalAtPath(
	_event: IpcMainInvokeEvent,
	targetPath: string,
	{ wpCliEnabled }: { wpCliEnabled?: boolean } = {}
) {
	return new Promise< void >( ( resolve, reject ) => {
		const platform = process.platform;
		const cliPath = nodePath.join( getResourcesPath(), 'bin' );

		const exePath = app.getPath( 'exe' );
		const appDirectory = app.getAppPath();
		const appPath = ! app.isPackaged ? `${ exePath } ${ appDirectory }` : exePath;

		let command: string;
		if ( platform === 'win32' ) {
			// Windows
			if ( wpCliEnabled ) {
				command = `start cmd /K "set PATH=${ cliPath };%PATH% && set STUDIO_APP_PATH=${ appPath } && cd /d ${ targetPath }"`;
			} else {
				command = `start cmd /K "cd /d ${ targetPath }"`;
			}
		} else if ( platform === 'darwin' ) {
			// macOS
			if ( wpCliEnabled ) {
				const script = `
			tell application "Terminal"
				if not application "Terminal" is running then launch
				do script "clear && export PATH=\\"${ cliPath }\\":$PATH && export STUDIO_APP_PATH=\\"${ appPath }\\" && cd ${ targetPath }"
				activate
			end tell
			`;
				command = `osascript -e '${ script }'`;
			} else {
				command = `open -a Terminal "${ targetPath }"`;
			}
		} else if ( platform === 'linux' ) {
			// Linux
			if ( wpCliEnabled ) {
				command = `export PATH=${ cliPath }:$PATH && export STUDIO_APP_PATH="${ appPath }" && gnome-terminal -- bash -c 'cd ${ targetPath }; exec bash'`;
			} else {
				command = `gnome-terminal --working-directory=${ targetPath }`;
			}
		} else {
			console.error( 'Unsupported platform:', platform );
			return;
		}

		exec( command, ( error, _stdout, _stderr ) => {
			if ( error ) {
				reject( error );
				return;
			}
			resolve();
		} );
	} );
}

export async function showMessageBox(
	event: IpcMainInvokeEvent,
	options: Electron.MessageBoxOptions
) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( parentWindow && ! parentWindow.isDestroyed() && ! event.sender.isDestroyed() ) {
		return dialog.showMessageBox( parentWindow, options );
	}
	return dialog.showMessageBox( options );
}

export async function showNotification(
	_event: IpcMainInvokeEvent,
	options: Electron.NotificationConstructorOptions
) {
	new Notification( options ).show();
}

export function setupAppMenu( _event: IpcMainInvokeEvent ) {
	setupMenu();
}

export function popupAppMenu( _event: IpcMainInvokeEvent ) {
	popupMenu();
}

export async function promptWindowsSpeedUpSites(
	_event: IpcMainInvokeEvent,
	{ skipIfAlreadyPrompted }: { skipIfAlreadyPrompted: boolean }
) {
	await windowsHelpers.promptWindowsSpeedUpSites( { skipIfAlreadyPrompted } );
}

export function setDefaultLocaleData( _event: IpcMainInvokeEvent, locale?: LocaleData ) {
	defaultI18n.setLocaleData( locale );
}
