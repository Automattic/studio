import { type IpcMainInvokeEvent } from 'electron';
import { loadUserData, saveUserData } from './storage/user-data';
import crypto from 'crypto';
import nodePath from 'path';

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

	userData.sites.push( {
		id: crypto.randomUUID(),
		name: nodePath.basename( path ),
		path,
		running: false,
	} );

	await saveUserData( userData );

	return userData.sites;
}
