import { getWpNowConfig } from '@wp-now/wp-now';
import archiver from 'archiver';
import { app } from 'electron';
import { type IpcMainInvokeEvent, dialog, shell } from 'electron';
import fs from 'fs';
import * as oauthClient from './lib/oauth';
import { loadUserData, saveUserData } from './storage/user-data';
import { SiteServer, createSiteWorkingDirectory } from './site-server';
import nodePath from 'path';
import crypto from 'crypto';
import { writeLogToFile, type LogLevel } from './logging';

// IPC functions must accept an `event` as the first argument.
/* eslint @typescript-eslint/no-unused-vars: ["warn", { "argsIgnorePattern": "event" }] */

const WPNOW_HOME = nodePath.join( app.getPath( 'home' ) || '', '.wp-now' );

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

export async function getSiteDetails( event: IpcMainInvokeEvent ): Promise< SiteDetails[] > {
	const userData = await loadUserData();

	// This is probably one of the first times the user data is loaded. Take the opportunity
	// to log for debugging purposes.
	console.log( 'Loaded user data', userData );

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
	path: string
): Promise< SiteDetails[] > {
	const userData = await loadUserData();

	if ( ! ( await createSiteWorkingDirectory( path ) ) ) {
		return userData.sites;
	}

	const details = {
		id: crypto.randomUUID(),
		name: nodePath.basename( path ),
		path,
		running: false,
	} as const;

	const server = SiteServer.create( details );

	userData.sites.push( server.details );
	await saveUserData( userData );

	await server.start();

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

export async function showOpenFolderDialog(
	event: IpcMainInvokeEvent,
	title: string
): Promise< string | null > {
	const { canceled, filePaths } = await dialog.showOpenDialog( {
		title,
		properties: [
			'openDirectory',
			'createDirectory', // allow user to create new directories; macOS only
		],
	} );
	if ( canceled ) {
		return null;
	}

	return filePaths[ 0 ];
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
			nodePath.join( WPNOW_HOME, 'sqlite-database-integration-main' ),
			'wp-content/plugins/sqlite-database-integration'
		);
		archive.file( nodePath.join( WPNOW_HOME, 'sqlite-database-integration-main', 'db.copy' ), {
			name: 'wp-content/db.php',
		} );
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
	const { wpContentPath } = await getWpNowConfig( {
		path: site.details.path,
	} );
	const sitePath = site.details.path;
	const zipPath = `${ sitePath }.zip`;
	await zipWordPressDirectory( {
		source: sitePath,
		zipPath,
		databasePath: nodePath.join( wpContentPath, 'database' ),
	} );
	shell.showItemInFolder( zipPath );
}

export function logRendererMessage(
	event: IpcMainInvokeEvent,
	level: LogLevel,
	...args: any[]
): void {
	// 4 characters long so it aligns with the main process logs
	const processId = `ren${ event.sender.id }`;
	writeLogToFile( level, processId, ...args );
}

export async function authenticate(
	event: IpcMainInvokeEvent
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

export async function openSiteURL( event: IpcMainInvokeEvent, id: string, relativeURL = '' ) {
	const site = SiteServer.get( id );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}
	shell.openExternal( site.server?.url + relativeURL );
}
