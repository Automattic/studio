import { type IpcMainInvokeEvent, dialog } from 'electron';
import { loadUserData, saveUserData } from './storage/user-data';
import { SiteServer, createSiteWorkingDirectory } from './site-server';
import nodePath from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { execSync } from 'child_process';
import archiver from 'archiver';

// IPC functions must accept an `event` as the first argument.
/* eslint @typescript-eslint/no-unused-vars: ["warn", { "argsIgnorePattern": "event" }] */

const WPNOW_HOME = nodePath.join( process.env.HOME || '', '.wp-now' );

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
	const { sites } = await loadUserData();
	console.log( 'Loaded user data', sites );

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
		console.log( 'Archiving database from', databasePath );
		archive.directory( databasePath, 'wp-content/database' );
		archive.finalize();
	} );
}

export async function archiveSite( event: IpcMainInvokeEvent, id: string ) {
	const site = SiteServer.get( id );
	if ( ! site ) {
		return;
	}
	if ( ! site.details.running ) {
		await site.start();
	}
	if ( ! site.server ) {
		return;
	}
	const sitePath = site.details.path;
	const zipPath = `${ sitePath }.zip`;
	await zipWordPressDirectory( {
		source: sitePath,
		zipPath,
		databasePath: nodePath.join( site.server.options.wpContentPath, 'database' ),
	} );
	execSync( `open "${ nodePath.dirname( zipPath ) }"` );
}
