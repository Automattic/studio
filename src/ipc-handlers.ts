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
} from 'electron';
import fs from 'fs';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import archiver from 'archiver';
import { copySync } from 'fs-extra';
import { SQLITE_FILENAME } from '../vendor/wp-now/src/constants';
import { downloadSqliteIntegrationPlugin } from '../vendor/wp-now/src/download';
import { LIMIT_ARCHIVE_SIZE } from './constants';
import { isEmptyDir, pathExists, isWordPressDirectory, sanitizeFolderName } from './lib/fs-utils';
import { getImageData } from './lib/get-image-data';
import { isErrnoException } from './lib/is-errno-exception';
import { isInstalled } from './lib/is-installed';
import { getLocaleData, getSupportedLocale } from './lib/locale';
import * as oauthClient from './lib/oauth';
import { createPassword } from './lib/passwords';
import { phpGetThemeDetails } from './lib/php-get-theme-details';
import { sanitizeForLogging } from './lib/sanitize-for-logging';
import { sortSites } from './lib/sort-sites';
import { writeLogToFile, type LogLevel } from './logging';
import { SiteServer, createSiteWorkingDirectory } from './site-server';
import { DEFAULT_SITE_PATH, getServerFilesPath, getSiteThumbnailPath } from './storage/paths';
import { loadUserData, saveUserData } from './storage/user-data';

const TEMP_DIR = nodePath.join( app.getPath( 'temp' ), 'com.wordpress.studio' ) + nodePath.sep;
if ( ! fs.existsSync( TEMP_DIR ) ) {
	fs.mkdirSync( TEMP_DIR );
}

async function sendThumbnailChangedEvent( event: IpcMainInvokeEvent, id: string ) {
	const thumbnailData = await getThumbnailData( event, id );
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( parentWindow ) {
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

// Use sqlite database and db.php file in situ
async function setupSqliteIntegration( path: string ) {
	await downloadSqliteIntegrationPlugin();
	const wpContentPath = nodePath.join( path, 'wp-content' );
	const databasePath = nodePath.join( wpContentPath, 'database' );

	fs.mkdirSync( databasePath, { recursive: true } );

	const dbPhpPath = nodePath.join( wpContentPath, 'db.php' );
	fs.copyFileSync( nodePath.join( getServerFilesPath(), SQLITE_FILENAME, 'db.copy' ), dbPhpPath );
	const dbCopyContent = fs.readFileSync( dbPhpPath ).toString();
	fs.writeFileSync(
		dbPhpPath,
		dbCopyContent.replace(
			"'{SQLITE_IMPLEMENTATION_FOLDER_PATH}'",
			`realpath( __DIR__ . '/mu-plugins/${ SQLITE_FILENAME }' )`
		)
	);
	const sqlitePluginPath = nodePath.join( wpContentPath, 'mu-plugins', SQLITE_FILENAME );
	await copySync( nodePath.join( getServerFilesPath(), SQLITE_FILENAME ), sqlitePluginPath );
}

export async function createSite(
	event: IpcMainInvokeEvent,
	path: string,
	siteName?: string
): Promise< SiteDetails[] > {
	const userData = await loadUserData();
	const forceSetupSqlite = false;
	let wasPathEmpty = false;
	// We only try to create the directory recursively if the user has
	// not selected a path from the dialog (and thus they use the "default" path)
	if ( ! ( await pathExists( path ) ) && path.startsWith( DEFAULT_SITE_PATH ) ) {
		try {
			fs.mkdirSync( path, { recursive: true } );
		} catch ( err ) {
			return userData.sites;
		}
	}

	if ( ! ( await isEmptyDir( path ) ) && ! isWordPressDirectory( path ) ) {
		wasPathEmpty = true;
		return userData.sites;
	}

	const allPaths = userData?.sites?.map( ( site ) => site.path ) || [];
	if ( allPaths.includes( path ) ) {
		return userData.sites;
	}

	if ( ( await pathExists( path ) ) && ( await isEmptyDir( path ) ) ) {
		await createSiteWorkingDirectory( path );
	}

	const details = {
		id: crypto.randomUUID(),
		name: siteName || nodePath.basename( path ),
		path,
		adminPassword: createPassword(),
		running: false,
	} as const;

	const server = SiteServer.create( details );

	if ( isWordPressDirectory( path ) ) {
		try {
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
				await setupSqliteIntegration( path );
			}
		} catch ( error ) {
			Sentry.captureException( error );
			if ( wasPathEmpty ) {
				// Clean the path to let the user try again
				await shell.trashItem( path );
			}
			throw new Error( 'Error creating the site. Please contact support.' );
		}
	}

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( parentWindow ) {
		parentWindow.webContents.send( 'theme-details-updating', details.id );
	}
	await server.start();
	if ( parentWindow ) {
		parentWindow.webContents.send(
			'theme-details-changed',
			details.id,
			server.details.themeDetails
		);
	}
	server.updateCachedThumbnail().then( () => sendThumbnailChangedEvent( event, details.id ) );

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

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	await server.start();
	if ( parentWindow ) {
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
	return { zipPath, zipContent, exceedsSizeLimit: stats.size > LIMIT_ARCHIVE_SIZE };
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
	const locale = getSupportedLocale();
	const localeData = getLocaleData( locale );

	return {
		platform: process.platform,
		locale,
		localeData,
		appName: app.name,
	};
}

export async function getWpVersion( _event: IpcMainInvokeEvent, wordPressPath: string ) {
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

export async function getThemeDetails( event: IpcMainInvokeEvent, id: string ) {
	const server = SiteServer.get( id );
	if ( ! server ) {
		throw new Error( 'Site not found.' );
	}

	if ( ! server.details.running || ! server.server ) {
		return null;
	}
	const themeDetails = await phpGetThemeDetails( server.server.php );

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	if ( themeDetails?.path && themeDetails.path !== server.details.themeDetails?.path ) {
		if ( parentWindow ) {
			parentWindow.webContents.send( 'theme-details-updating', id );
		}
		const updatedSite = {
			...server.details,
			themeDetails,
		};
		if ( parentWindow ) {
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

export async function getThumbnailData( _event: IpcMainInvokeEvent, id: string ) {
	const path = getSiteThumbnailPath( id );
	return getImageData( path );
}

export function openTerminalAtPath( _event: IpcMainInvokeEvent, targetPath: string ) {
	return new Promise< void >( ( resolve, reject ) => {
		const platform = process.platform;

		let command: string;
		if ( platform === 'win32' ) {
			// Windows
			command = `start cmd /K "cd /d ${ targetPath }"`;
		} else if ( platform === 'darwin' ) {
			// macOS
			command = `open -a Terminal "${ targetPath }"`;
		} else if ( platform === 'linux' ) {
			// Linux
			command = `gnome-terminal --working-directory=${ targetPath }`;
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
	if ( parentWindow ) {
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
