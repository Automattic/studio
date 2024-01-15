import { type IpcMainInvokeEvent } from 'electron';
import { loadUserData, saveUserData } from './storage/user-data';
import { createSiteServer } from './site-server';

// IPC functions must accept an `event` as the first argument.
/* eslint @typescript-eslint/no-unused-vars: ["warn", { "argsIgnorePattern": "event" }] */

export async function ping( event: IpcMainInvokeEvent, message: string ): Promise< string > {
	return message;
}

export async function getSiteDetails( event: IpcMainInvokeEvent ): Promise< SiteDetails[] > {
	const { sites } = await loadUserData();
	return sites;
}

export async function createSite(
	event: IpcMainInvokeEvent,
	path: string
): Promise< SiteDetails[] > {
	const userData = await loadUserData();

	const server = await createSiteServer( path );
	if ( ! server ) {
		return userData.sites;
	}

	userData.sites.push( server.details );
	await saveUserData( userData );

	await server.start();

	return userData.sites;
}
