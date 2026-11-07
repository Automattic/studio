import { IpcMainInvokeEvent } from 'electron';
import {
	listSpacefastSpaces as fetchSpacefastSpaces,
	listSpacefastTeams as fetchSpacefastTeams,
	startSpacefastDeviceLogin,
	waitForSpacefastDeviceLogin,
} from '@studio/common/lib/spacefast/api';
import {
	clearSpacefastAuth,
	getSpacefastConnection as readSpacefastConnection,
	readSpacefastAuth,
	removeSpacefastConnection,
	saveSpacefastAuth,
} from '@studio/common/lib/spacefast/config';
import { readSitePath } from '@studio/common/sites/site-path';
import { publishSiteToSpacefast } from '@studio/common/sites/spacefast';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import type {
	SpacefastConnection,
	SpacefastDeviceLogin,
	SpacefastPublishTarget,
	SpacefastSpace,
	SpacefastTeam,
} from '@studio/common/types/spacefast';

async function requireApiKey(): Promise< string > {
	const auth = await readSpacefastAuth();
	if ( ! auth ) {
		throw new Error( 'Log in to Spacefast first.' );
	}
	return auth.apiKey;
}

export async function isSpacefastSignedIn( _event: IpcMainInvokeEvent ): Promise< boolean > {
	return ( await readSpacefastAuth() ) !== null;
}

// The renderer opens `verificationUrl`, then waits on `completeSpacefastLogin`.
export async function startSpacefastLogin(
	_event: IpcMainInvokeEvent
): Promise< SpacefastDeviceLogin > {
	return startSpacefastDeviceLogin();
}

export async function completeSpacefastLogin(
	_event: IpcMainInvokeEvent,
	login: SpacefastDeviceLogin
): Promise< void > {
	await saveSpacefastAuth( await waitForSpacefastDeviceLogin( login ) );
}

export async function logoutSpacefast( _event: IpcMainInvokeEvent ): Promise< void > {
	await clearSpacefastAuth();
}

export async function listSpacefastSpaces(
	_event: IpcMainInvokeEvent
): Promise< SpacefastSpace[] > {
	return fetchSpacefastSpaces( await requireApiKey() );
}

export async function listSpacefastTeams( _event: IpcMainInvokeEvent ): Promise< SpacefastTeam[] > {
	return fetchSpacefastTeams( await requireApiKey() );
}

export async function getSpacefastConnection(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< SpacefastConnection | null > {
	return readSpacefastConnection( siteId );
}

export async function disconnectSpacefastSite(
	_event: IpcMainInvokeEvent,
	siteId: string
): Promise< void > {
	await removeSpacefastConnection( siteId );
}

export async function publishSiteToSpacefastSpace(
	_event: IpcMainInvokeEvent,
	siteId: string,
	target: SpacefastPublishTarget
): Promise< SpacefastConnection > {
	const sitePath = await readSitePath( siteId );
	if ( ! sitePath ) {
		throw new Error( 'Site not found.' );
	}
	return publishSiteToSpacefast( executeCliCommand, sitePath, target );
}
