import { IpcMainInvokeEvent } from 'electron';
import {
	forgetRemoteSite,
	getRemoteSites as readRemoteSites,
	rememberRemoteSite,
	type RemoteSiteConnection,
} from '@studio/common/lib/remote-sites';
import { getSitePublishStatus as getPublishStatus } from '@studio/common/sites/publish-status';
import {
	getSiteVisibility as readVisibility,
	setSiteVisibility as writeVisibility,
	createRemoteSite as createRemoteSiteOnProvider,
	getRemoteBackupId as readRemoteBackupId,
	listAccountSites as listProviderAccountSites,
	listRemoteBackupFiles as readRemoteBackupFiles,
} from '@studio/common/sites/remote-sites';
import { readSitePath } from '@studio/common/sites/site-path';
import { createSyncRunner, type SyncResult } from '@studio/common/sites/sync';
import { PullSyncOptions, PushSyncOptions } from '@studio/common/types/sync';
import {
	normalizeProviderId,
	SITES_PROVIDER_IDS,
	type ProviderSites,
	type SitesProviderId,
} from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { getAuthenticationToken } from 'src/lib/oauth';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import type { WpcomSiteVisibility } from '@studio/common/types/site-visibility';

const syncRunner = createSyncRunner( executeCliCommand );

function parseProvider( requested: string ): SitesProviderId {
	const provider = normalizeProviderId( requested, SITES_PROVIDER_IDS );
	if ( ! provider ) {
		throw new Error( `Unknown provider with sites: ${ requested }` );
	}
	return provider;
}

async function requireSitePath( siteId: string ): Promise< string > {
	const sitePath = await readSitePath( siteId );
	if ( ! sitePath ) {
		throw new Error( 'Site not found.' );
	}
	return sitePath;
}

export async function getRemoteSites(
	_event: IpcMainInvokeEvent,
	provider: string,
	localSiteId?: string
): Promise< RemoteSiteConnection< SitesProviderId >[] > {
	return readRemoteSites( parseProvider( provider ), localSiteId );
}

export async function listAccountSites(
	_event: IpcMainInvokeEvent,
	provider: string
): Promise< ProviderSites[ SitesProviderId ][] > {
	return listProviderAccountSites( getProviderServices( parseProvider( provider ) ) );
}

export async function connectRemoteSite(
	_event: IpcMainInvokeEvent,
	provider: string,
	localSiteId: string,
	site: ProviderSites[ SitesProviderId ]
): Promise< void > {
	await rememberRemoteSite( parseProvider( provider ), localSiteId, site as never );
}

export async function disconnectRemoteSite(
	_event: IpcMainInvokeEvent,
	provider: string,
	localSiteId: string,
	remoteSiteId: string | number
): Promise< void > {
	await forgetRemoteSite( parseProvider( provider ), localSiteId, remoteSiteId as never );
}

export async function createRemoteSite(
	_event: IpcMainInvokeEvent,
	provider: string,
	localSiteId: string,
	name: string
): Promise< ProviderSites[ SitesProviderId ] > {
	return createRemoteSiteOnProvider(
		getProviderServices( parseProvider( provider ) ),
		localSiteId,
		name
	);
}

// A cancel resolves rather than rejects, so it isn't logged as a handler error in
// the very log we point users at when a sync fails.
export async function pushSite(
	_event: IpcMainInvokeEvent,
	provider: string,
	siteId: string,
	remoteSiteId: string | number,
	options?: PushSyncOptions
): Promise< SyncResult > {
	return syncRunner.push(
		siteId,
		await requireSitePath( siteId ),
		{ provider: parseProvider( provider ), id: remoteSiteId },
		options
	);
}

export async function pullSite(
	_event: IpcMainInvokeEvent,
	provider: string,
	siteId: string,
	remoteSiteId: string | number,
	options?: PullSyncOptions
): Promise< SyncResult > {
	return syncRunner.pull(
		siteId,
		await requireSitePath( siteId ),
		{ provider: parseProvider( provider ), id: remoteSiteId },
		options
	);
}

export function cancelSyncOperation(
	_event: IpcMainInvokeEvent,
	siteId: string,
	remoteSiteId: string | number
) {
	syncRunner.cancel( siteId, remoteSiteId );
}

/**
 * The remote site's latest backup, which a selective pull browses. Rejects when the site has no
 * backup yet (or the lookup fails): the dialog relies on the error state to disable per-item
 * selection and force a full sync.
 */
export async function getRemoteBackupId(
	_event: IpcMainInvokeEvent,
	provider: string,
	remoteSiteId: string | number
): Promise< string | null > {
	return readRemoteBackupId(
		getProviderServices( parseProvider( provider ) ),
		remoteSiteId as never
	);
}

/**
 * Raw contents of a remote backup directory, keyed by entry name. The renderer maps entries to
 * tree nodes; returning the raw items preserves `has_children`/`type` used for plugin/theme
 * classification.
 */
export async function listRemoteBackupFiles(
	_event: IpcMainInvokeEvent,
	provider: string,
	remoteSiteId: string | number,
	backupId: string,
	path: string
): Promise< Record< string, unknown > > {
	return readRemoteBackupFiles(
		getProviderServices( parseProvider( provider ) ),
		remoteSiteId as never,
		backupId,
		path
	);
}

export async function getWpcomSiteVisibility( _event: IpcMainInvokeEvent, remoteSiteId: number ) {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) throw new Error( 'Authentication required to read site visibility.' );
	return readVisibility< 'wpcom' >( getProviderServices( 'wpcom' ), remoteSiteId );
}

export async function setWpcomSiteVisibility(
	_event: IpcMainInvokeEvent,
	remoteSiteId: number,
	visibility: WpcomSiteVisibility
) {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken )
		throw new Error( 'Authentication required to change site visibility.' );
	return writeVisibility< 'wpcom' >( getProviderServices( 'wpcom' ), remoteSiteId, visibility );
}

export function getSitePublishStatus(
	_event: IpcMainInvokeEvent,
	siteId: string,
	remoteSiteId: string | number,
	provider: SitesProviderId = 'wpcom'
) {
	return getPublishStatus( executeCliCommand, siteId, remoteSiteId, provider );
}

export function getSiteVisibility(
	_event: IpcMainInvokeEvent,
	provider: string,
	id: string | number
) {
	return readVisibility( getProviderServices( parseProvider( provider ) ), id as never );
}
export function setSiteVisibility(
	_event: IpcMainInvokeEvent,
	provider: string,
	id: string | number,
	value: WpcomSiteVisibility
) {
	return writeVisibility( getProviderServices( parseProvider( provider ) ), id as never, value );
}
