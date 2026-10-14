import { IpcMainInvokeEvent } from 'electron';
import {
	addConnectedWpcomSite,
	getAllConnectedWpcomSitesForCurrentUser as getAllConnectedWpcomSitesForCurrentUserShared,
	getConnectedWpcomSitesForLocalSite,
	removeConnectedWpcomSite,
} from '@studio/common/lib/connected-sites';
import { getCurrentUserId } from '@studio/common/lib/shared-config';
import { isSyncCancelledError } from '@studio/common/lib/sync/cancel';
import { fetchLatestRewindId, fetchSyncableSites } from '@studio/common/lib/sync/sync-api';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { readSitePath } from '@studio/common/sites/site-path';
import { pullSite, pushSite } from '@studio/common/sites/sync';
import { PullSyncOptions, PushSyncOptions, SyncSite } from '@studio/common/types/sync';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { getAuthenticationToken } from 'src/lib/oauth';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

/**
 * Registry to store AbortControllers for ongoing sync operations (push/pull).
 * Key format: `${selectedSiteId}-${remoteSiteId}`
 */
const SYNC_ABORT_CONTROLLERS = new Map< string, AbortController >();

type SyncOperationResult = { cancelled: boolean };

export function cancelSyncOperation( event: IpcMainInvokeEvent, id: string ) {
	const abortController = SYNC_ABORT_CONTROLLERS.get( id );
	if ( abortController ) {
		abortController.abort();
		SYNC_ABORT_CONTROLLERS.delete( id );
	}
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

// Registered under the legacy renderer's key, so `cancelSyncOperation` stops these too.
async function runCancellableSync(
	siteId: string,
	remoteSiteId: number,
	sync: ( sitePath: string, signal: AbortSignal ) => Promise< void >
): Promise< SyncOperationResult > {
	const sitePath = await readSitePath( siteId );
	if ( ! sitePath ) {
		throw new Error( 'Site not found.' );
	}
	const operationId = `${ siteId }-${ remoteSiteId }`;
	const abortController = new AbortController();
	SYNC_ABORT_CONTROLLERS.set( operationId, abortController );
	try {
		await sync( sitePath, abortController.signal );
		return { cancelled: false };
	} catch ( error ) {
		// A user cancel is an intentional stop, not a failure. Rejecting here would
		// make Electron log it as a handler error in the very log we point users at
		// when a sync fails, so report it as a result instead — the renderer turns it
		// back into a cancelled operation. Same reasoning as `downloadSyncBackup`.
		if ( isSyncCancelledError( error ) ) {
			console.log( `[Sync] Cancelled by user for operation: ${ operationId }` );
			return { cancelled: true };
		}
		throw error;
	} finally {
		if ( SYNC_ABORT_CONTROLLERS.get( operationId ) === abortController ) {
			SYNC_ABORT_CONTROLLERS.delete( operationId );
		}
	}
}

export async function pullSiteFromLive(
	_event: IpcMainInvokeEvent,
	siteId: string,
	remoteSiteId: number,
	options?: PullSyncOptions
): Promise< SyncOperationResult > {
	return runCancellableSync( siteId, remoteSiteId, ( sitePath, signal ) =>
		pullSite( executeCliCommand, sitePath, remoteSiteId, options, signal )
	);
}

export async function pushSiteToLive(
	_event: IpcMainInvokeEvent,
	siteId: string,
	remoteSiteId: number,
	options?: PushSyncOptions
): Promise< SyncOperationResult > {
	return runCancellableSync( siteId, remoteSiteId, ( sitePath, signal ) =>
		pushSite( executeCliCommand, sitePath, remoteSiteId, options, signal )
	);
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
 * Latest rewind (backup) id for a remote site — used by the agentic UI's
 * selective pull to browse the remote backup file tree. Rejects when the site
 * has no backup yet (or the lookup fails), like the classic renderer's query:
 * the dialog relies on the error state to disable per-item selection and
 * force a full sync.
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
	const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
	const rawResponse = await wpcom.req.post( {
		path: `/sites/${ remoteSiteId }/rewind/backup/ls`,
		apiNamespace: 'wpcom/v2',
		body: { backup_id: rewindId, path: treePath },
	} );
	const parsed = z
		.object( {
			ok: z.boolean(),
			error: z.string().optional(),
			contents: z.record( z.string(), z.unknown() ).optional(),
		} )
		.parse( rawResponse );
	if ( ! parsed.ok ) {
		throw new Error( parsed.error || 'Failed to fetch remote file tree' );
	}
	return parsed.contents ?? {};
}

/**
 * PHP version of the remote site's hosting environment — used by the agentic
 * UI's sync dialog to warn about version mismatches before pushing.
 */
export async function getHostingPhpVersion(
	_event: IpcMainInvokeEvent,
	remoteSiteId: number
): Promise< string | undefined > {
	const token = await getAuthenticationToken();
	if ( ! token?.accessToken ) {
		throw new Error( 'No token found' );
	}
	try {
		const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );
		const response = await wpcom.req.get( {
			apiNamespace: 'wpcom/v2',
			path: `/sites/${ remoteSiteId }/hosting/php-version`,
		} );
		return z.string().parse( response );
	} catch {
		return undefined;
	}
}
