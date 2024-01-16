import { type IpcMainInvokeEvent, dialog } from 'electron';
import { loadUserData, saveUserData } from './storage/user-data';
import { SiteServer, createSiteWorkingDirectory } from './site-server';
import nodePath from 'path';
import crypto from 'crypto';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;

function validateIpcSender( event: IpcMainInvokeEvent ) {
	if ( new URL( event.senderFrame.url ).origin === new URL( MAIN_WINDOW_WEBPACK_ENTRY ).origin ) {
		return true;
	}

	throw new Error( 'Invalid IPC sender' );
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

export async function getSiteDetails( event: IpcMainInvokeEvent ): Promise< SiteDetails[] > {
	validateIpcSender( event );

	const { sites } = await loadUserData();

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
	validateIpcSender( event );

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
	validateIpcSender( event );

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
	validateIpcSender( event );

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
	validateIpcSender( event );

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
