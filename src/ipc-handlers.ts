import crypto from 'crypto';
import { BrowserWindow, app, clipboard } from 'electron';
import { type IpcMainInvokeEvent, dialog, shell } from 'electron';
import fs from 'fs';
import nodePath from 'path';
import * as Sentry from '@sentry/electron/main';
import archiver from 'archiver';
import { getWpNowConfig } from '../vendor/wp-now/src';
import { isEmptyDir, pathExists, isWordPressDirectory } from './lib/fs-utils';
import { getLocaleData, getSupportedLocale } from './lib/locale';
import * as oauthClient from './lib/oauth';
import { sanitizeForLogging } from './lib/sanitize-for-logging';
import { sortSites } from './lib/sort-sites';
import { writeLogToFile, type LogLevel } from './logging';
import { SiteServer, createSiteWorkingDirectory } from './site-server';
import { DEFAULT_SITE_PATH, getServerFilesPath } from './storage/paths';
import { loadUserData, saveUserData } from './storage/user-data';

const TEMP_DIR = nodePath.join( app.getPath( 'temp' ), 'com.wordpress.build' ) + nodePath.sep;
if ( ! fs.existsSync( TEMP_DIR ) ) {
	fs.mkdirSync( TEMP_DIR );
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

export async function createSite(
	event: IpcMainInvokeEvent,
	path: string,
	siteName?: string
): Promise< SiteDetails[] > {
	const userData = await loadUserData();

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
		userData.sites;
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
		running: false,
	} as const;

	const server = SiteServer.create( details );

	if ( isWordPressDirectory( path ) ) {
		// If the directory contains a WordPress installation, let's rename the wp-config.php file
		// to allow WP Now to create a new one
		// and initialize things properly.
		try {
			fs.renameSync(
				nodePath.join( path, 'wp-config.php' ),
				nodePath.join( path, 'wp-config.php.wpbuild' )
			);
		} catch ( error ) {
			/* Empty */
		}
	}

	await server.start();

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

	await server.start();
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

	const { canceled, filePaths } = await dialog.showOpenDialog( parentWindow, {
		title,
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

function zipWordPressDirectory( {
	source,
	zipPath,
	databasePath,
}: {
	source: string;
	zipPath: string;
	databasePath: string;
} ) {
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
		// Archive SQLite plugin
		archive.directory(
			nodePath.join( getServerFilesPath(), 'sqlite-database-integration-main' ),
			'wp-content/plugins/sqlite-database-integration'
		);
		archive.file(
			nodePath.join( getServerFilesPath(), 'sqlite-database-integration-main', 'db.copy' ),
			{
				name: 'wp-content/db.php',
			}
		);
		// Archive SQLite database
		archive.directory( databasePath, 'wp-content/database' );
		archive.finalize();
	} );
}

export async function archiveSite( event: IpcMainInvokeEvent, id: string ) {
	const site = SiteServer.get( id );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	const { wpContentPath = '' } = await getWpNowConfig( {
		path: site.details.path,
	} );
	const sitePath = site.details.path;
	const zipPath = `${ TEMP_DIR }site_${ id }.zip`;
	await zipWordPressDirectory( {
		source: sitePath,
		zipPath,
		databasePath: nodePath.join( wpContentPath, 'database' ),
	} );
	const zipContent = fs.readFileSync( zipPath );
	return { zipPath, zipContent };
}

export function removeTemporalFile( event: IpcMainInvokeEvent, path: string ) {
	if ( ! path.includes( TEMP_DIR ) ) {
		throw new Error( 'The given path is not a temporal file' );
	}
	return fs.unlinkSync( path );
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

export async function authenticate(
	_event: IpcMainInvokeEvent
): Promise< oauthClient.StoredToken | null > {
	return await oauthClient.authenticate();
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
	const localeData = await getLocaleData( locale );

	return {
		platform: process.platform,
		locale,
		localeData,
	};
}

export async function getWpVersion( _event: IpcMainInvokeEvent, wordPressPath: string ) {
	const versionFileContent = fs.readFileSync(
		nodePath.join( wordPressPath, 'wp-includes', 'version.php' ),
		'utf8'
	);
	const matches = versionFileContent.match( /\$wp_version = '([\d.]+)'/ );
	return matches?.[ 1 ] || '-';
}

export async function generateProposedSitePath( _event: IpcMainInvokeEvent, siteName: string ) {
	return nodePath.join( DEFAULT_SITE_PATH, siteName );
}

export async function openLocalPath( _event: IpcMainInvokeEvent, path: string ) {
	shell.openPath( path );
}
