import { IpcMainInvokeEvent } from 'electron';
import {
	addConnectedWpcomSite,
	getAllConnectedWpcomSitesForCurrentUser as getAllConnectedWpcomSitesForCurrentUserShared,
	getConnectedWpcomSitesForLocalSite,
	removeConnectedWpcomSite,
} from '@studio/common/lib/connected-sites';
import { getCurrentUserId } from '@studio/common/lib/shared-config';
import {
	fetchHostingPhpVersion,
	fetchLatestRewindId,
	fetchRemoteFileTreeContents,
	fetchSyncableSites,
} from '@studio/common/lib/sync/sync-api';
import { readSitePath } from '@studio/common/sites/site-path';
import { createSyncRunner, type SyncResult } from '@studio/common/sites/sync';
import { PullSyncOptions, PushSyncOptions, SyncSite } from '@studio/common/types/sync';
import { getAuthenticationToken } from 'src/lib/oauth';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

const syncRunner = createSyncRunner( executeCliCommand );

export function cancelSyncOperation(
	_event: IpcMainInvokeEvent,
	siteId: string,
	remoteSiteId: number
) {
	syncRunner.cancel( siteId, remoteSiteId );
}

type WpcomSitesToConnect = { sites: SyncSite[]; localSiteId: string }[];

export async function connectWpcomSites( event: IpcMainInvokeEvent, list: WpcomSitesToConnect ) {
	const currentUserId = await getCurrentUserId();
	if ( ! currentUserId ) {
		throw new Error( 'User not authenticated' );
	}

	for ( const { sites, localSiteId } of list ) {
		for ( const siteToAdd of sites ) {
			await addConnectedWpcomSite( localSiteId, siteToAdd );
		}
	}
}

type WpcomSitesToDisconnect = { siteIds: number[]; localSiteId: string }[];

export async function disconnectWpcomSites(
	event: IpcMainInvokeEvent,
	list: WpcomSitesToDisconnect
) {
	const currentUserId = await getCurrentUserId();
	if ( ! currentUserId ) {
		throw new Error( 'User not authenticated' );
	}

	for ( const { siteIds, localSiteId } of list ) {
		for ( const id of siteIds ) {
			await removeConnectedWpcomSite( localSiteId, id );
		}
	}
}

async function requireSitePath( siteId: string ): Promise< string > {
	const sitePath = await readSitePath( siteId );
	if ( ! sitePath ) {
		throw new Error( 'Site not found.' );
	}
	return sitePath;
}

// A cancel resolves rather than rejects, so it isn't logged as a handler error in
// the very log we point users at when a sync fails.
export async function pullSiteFromLive(
	_event: IpcMainInvokeEvent,
	siteId: string,
	remoteSiteId: number,
	options?: PullSyncOptions
): Promise< SyncResult > {
	return syncRunner.pull( siteId, await requireSitePath( siteId ), remoteSiteId, options );
}

export async function pushSiteToLive(
	_event: IpcMainInvokeEvent,
	siteId: string,
	remoteSiteId: number,
	options?: PushSyncOptions
): Promise< SyncResult > {
	return syncRunner.push( siteId, await requireSitePath( siteId ), remoteSiteId, options );
}

// Fetches every WordPress.com site the authenticated user can sync to.
// The desktop renderer builds this list itself via its own WPCOM client
// (see wpcomSitesApi.getWpComSites); apps/ui doesn't own a wpcom client
// yet, so we expose a thin IPC wrapper that reuses the stored auth token.
export async function fetchSyncableWpcomSites( _event: IpcMainInvokeEvent ): Promise< SyncSite[] > {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) {
		throw new Error( 'Authentication required to fetch WordPress.com sites.' );
	}
	return fetchSyncableSites( token.accessToken );
}

export async function getConnectedWpcomSites(
	_event: IpcMainInvokeEvent,
	localSiteId?: string
): Promise< SyncSite[] > {
	if ( localSiteId ) {
		return getConnectedWpcomSitesForLocalSite( localSiteId );
	}
	return getAllConnectedWpcomSitesForCurrentUserShared();
}

/**
 * Latest rewind (backup) id for a remote site, used by selective pull to browse
 * the remote backup file tree. Rejects when the site has no backup yet (or the
 * lookup fails): the dialog relies on the error state to disable per-item
 * selection and force a full sync.
 */
export async function getLatestRewindId(
	_event: IpcMainInvokeEvent,
	remoteSiteId: number
): Promise< string | null > {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) {
		throw new Error( 'No token found' );
	}
	return fetchLatestRewindId( token.accessToken, remoteSiteId );
}

/**
 * Raw contents of a remote backup directory (rewind backup `ls`), keyed by
 * entry name. The renderer maps entries to tree nodes; returning the raw
 * items preserves `has_children`/`type` used for plugin/theme classification.
 */
export async function listRemoteFileTree(
	_event: IpcMainInvokeEvent,
	remoteSiteId: number,
	rewindId: string,
	treePath: string
): Promise< Record< string, unknown > > {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) {
		throw new Error( 'No token found' );
	}
	return fetchRemoteFileTreeContents( token.accessToken, remoteSiteId, rewindId, treePath );
}

/**
 * PHP version of the remote site's hosting environment — used by the sync
 * dialog to warn about version mismatches before pushing.
 */
export async function getHostingPhpVersion(
	_event: IpcMainInvokeEvent,
	remoteSiteId: number
): Promise< string | undefined > {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) {
		throw new Error( 'No token found' );
	}
	return fetchHostingPhpVersion( token.accessToken, remoteSiteId );
}
