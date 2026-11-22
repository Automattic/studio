import { readConfig, updateConfig } from '@studio/common/lib/config/store';
import { setRemoteSiteDetails } from '@studio/common/lib/remote-sites';
import {
	destinationConnection,
	recordTransfer,
	findPreviewConnection,
	lastTransferTime,
	recordPreviewTransfer,
} from '@studio/common/lib/site-connections';
import { isSnapshotExpired, isWpcomPreview } from '@studio/common/lib/snapshots';
import { type Snapshot } from '@studio/common/types/snapshot';
import { __ } from '@wordpress/i18n';
import { LoggerError } from 'cli/logger';
import { getSiteByFolder } from './sites';
import type { Config } from '@studio/common/lib/config/schema';
import type { SyncSite } from '@studio/common/types/sync';
import type { PreviewSite } from '@studio/providers';

/** How many unexpired previews the user has of one local site. */
export function countSitePreviews( siteId: string, snapshots: Snapshot[], userId: number ): number {
	return snapshots.filter(
		( s ) => s.localSiteId === siteId && s.userId === userId && ! isSnapshotExpired( s )
	).length;
}

export function getNextSnapshotSequence(
	siteId: string,
	snapshots: Snapshot[],
	userId: number
): number {
	const siteSnapshots = snapshots.filter(
		( s ) => s.localSiteId === siteId && s.userId === userId
	);

	const existingSequences = siteSnapshots
		.map( ( s ) => s.sequence ?? 0 )
		.filter( ( n ) => ! isNaN( n ) );

	return existingSequences.length > 0
		? Math.max( ...existingSequences ) + 1
		: siteSnapshots.length + 1;
}

// What a saved preview takes from the provider's.
function previewFields( preview: PreviewSite ) {
	return {
		url: new URL( preview.url ).hostname,
		atomicSiteId: Number( preview.id ),
		shareUrl: preview.shareUrl,
		launchUrl: preview.launchUrl,
		expiresAt: preview.expiresAt,
		liveSiteId: preview.liveSiteId === undefined ? undefined : Number( preview.liveSiteId ),
	};
}

function withTransfer( config: Config, snapshot: Snapshot ): Snapshot {
	const local = config.sites.find( ( site ) => site.id === snapshot.localSiteId );
	const connection = findPreviewConnection( local, snapshot );
	if ( ! connection ) return snapshot;
	return {
		...snapshot,
		versionId: connection.localVersionId ?? undefined,
		syncedAt: connection.localVersionId === null ? undefined : lastTransferTime( connection ),
	};
}

function forgetPreviewConnection( config: Config, preview: Snapshot ) {
	const local = config.sites.find( ( site ) => site.id === preview.localSiteId );
	const connection = findPreviewConnection( local, preview );
	if ( local?.connections && connection?.preview ) {
		local.connections = local.connections.filter( ( item ) => item !== connection );
		if ( ! local.connections.length ) delete local.connections;
	}
}

export async function getSnapshotsFromConfig(
	userId: number,
	siteFolder?: string
): Promise< Snapshot[] > {
	const config = await readConfig();
	let snapshots = config.snapshots.filter( ( snapshot ) => snapshot.userId === userId );

	if ( siteFolder ) {
		const site = await getSiteByFolder( siteFolder );
		snapshots = snapshots.filter( ( snapshot ) => snapshot.localSiteId === site.id );
	}

	return snapshots.map( ( snapshot ) => withTransfer( config, snapshot ) );
}

export async function saveSnapshotToConfig(
	siteFolder: string,
	preview: PreviewSite,
	userId: number,
	name: string,
	versionId?: string
): Promise< Snapshot > {
	const site = await getSiteByFolder( siteFolder );
	const fields = previewFields( preview );
	const { atomicSiteId } = fields;
	return updateConfig( ( config ) => {
		const existing = config.snapshots.find( ( s ) => s.atomicSiteId === atomicSiteId );
		const nextSequenceNumber = getNextSnapshotSequence( site.id, config.snapshots, userId );
		const snapshot: Snapshot = {
			...( existing?.tracksId ? { tracksId: existing.tracksId } : {} ),
			...fields,
			localSiteId: site.id,
			date: Date.now(),
			name,
			sequence: nextSequenceNumber,
			userId,
		};

		// A sync while the preview was being created may already have listed it.
		config.snapshots = config.snapshots.filter( ( s ) => s.atomicSiteId !== atomicSiteId );
		config.snapshots.push( snapshot );
		const local = config.sites.find( ( item ) => item.id === site.id );
		if ( local ) recordPreviewTransfer( local, snapshot, 'push', versionId, snapshot.date );
		return withTransfer( config, snapshot );
	} );
}

/**
 * Attaches a pulled preview to the local site it was pulled into, so updating the preview pushes
 * this site to it. A preview already attached to another local site keeps that link. Without
 * `sync`, the pull was partial, so what the two have in common is unknown.
 */
export async function linkPulledPreview(
	localSiteId: string,
	userId: number,
	preview: PreviewSite,
	remote: SyncSite,
	sync?: { versionId?: string; syncedAt: number }
): Promise< void > {
	const fields = previewFields( preview );
	return updateConfig( ( config ) => {
		let snapshot = config.snapshots.find( ( s ) => s.atomicSiteId === fields.atomicSiteId );
		if ( ! snapshot ) {
			snapshot = { ...fields, localSiteId: '', date: Date.now(), userId };
			config.snapshots.push( snapshot );
		}
		const local = config.sites.find( ( item ) => item.id === localSiteId );
		if ( local ) {
			// Remember this pull even if another local site owns the preview.
			const connection = destinationConnection( local, 'wpcom', String( userId ), remote.id );
			setRemoteSiteDetails( connection, 'wpcom', remote );
			recordTransfer(
				connection,
				'pull',
				sync ? sync.versionId : null,
				sync?.syncedAt ?? Date.now()
			);
		}
		if ( ! snapshot.localSiteId ) snapshot.localSiteId = localSiteId;
		if ( snapshot.localSiteId === localSiteId ) {
			delete snapshot.versionId;
			delete snapshot.syncedAt;
		}
	} );
}

export async function updateSnapshotInConfig(
	siteFolder: string,
	preview: PreviewSite,
	versionId?: string
): Promise< Snapshot > {
	const site = await getSiteByFolder( siteFolder );
	const { atomicSiteId, shareUrl, liveSiteId } = previewFields( preview );
	return updateConfig( ( config ) => {
		const snapshot = config.snapshots.find( ( s ) => s.atomicSiteId === atomicSiteId );
		if ( ! snapshot ) {
			throw new LoggerError( __( 'Failed to find existing preview site in config' ) );
		}

		if ( snapshot.localSiteId !== site.id ) forgetPreviewConnection( config, snapshot );
		snapshot.localSiteId = site.id;
		delete snapshot.versionId;
		delete snapshot.syncedAt;
		snapshot.date = Date.now();
		const local = config.sites.find( ( item ) => item.id === site.id );
		if ( local ) recordPreviewTransfer( local, snapshot, 'push', versionId, snapshot.date );
		snapshot.liveSiteId = liveSiteId;
		// The update restarted the server's window; the next sync reports where it now ends.
		delete snapshot.expiresAt;
		if ( shareUrl ) {
			snapshot.shareUrl = shareUrl;
		}

		return withTransfer( config, snapshot );
	} );
}

export async function deleteSnapshotFromConfig( snapshotUrl: string ): Promise< void > {
	return updateConfig( ( config ) => {
		for ( const preview of config.snapshots.filter( ( s ) => s.url === snapshotUrl ) )
			forgetPreviewConnection( config, preview );
		config.snapshots = config.snapshots.filter( ( s ) => s.url !== snapshotUrl );
	} );
}

export async function deleteAllSnapshotsForUserFromConfig( userId: number ): Promise< void > {
	return updateConfig( ( config ) => {
		for ( const preview of config.snapshots.filter( ( s ) => s.userId === userId ) )
			forgetPreviewConnection( config, preview );
		config.snapshots = config.snapshots.filter( ( s ) => s.userId !== userId );
	} );
}

export async function pruneExpiredOrphanedSnapshots(
	userId: number,
	isExpired: ( snapshot: Snapshot ) => boolean
): Promise< number > {
	return updateConfig( ( config ) => {
		const siteIds = new Set( config.sites.map( ( s ) => s.id ) );
		const filtered = config.snapshots.filter( ( snapshot ) => {
			if ( snapshot.userId !== userId ) {
				return true;
			}
			if ( siteIds.has( snapshot.localSiteId ) ) {
				return true;
			}
			return ! isExpired( snapshot );
		} );
		const pruned = config.snapshots.length - filtered.length;
		config.snapshots = filtered;
		return pruned;
	} );
}

export async function setSnapshotInConfig(
	snapshotUrl: string,
	updates: { name?: string }
): Promise< Snapshot > {
	return updateConfig( ( config ) => {
		const snapshot = config.snapshots.find( ( s ) => s.url === snapshotUrl );
		if ( ! snapshot ) {
			throw new LoggerError( __( 'Preview site not found in config' ) );
		}

		if ( updates.name !== undefined ) {
			snapshot.name = updates.name;
		}

		return withTransfer( config, snapshot );
	} );
}

/**
 * Brings the user's WordPress.com previews in line with the server: forgets those it no longer has
 * standing (bought, expired or deleted elsewhere), records when the rest expire, the preview link
 * it hands out for each and the paid site each shows changes to, and lists the ones made elsewhere
 * (another computer or tool), since they count toward the account's limit too. A preview saved
 * after `checkedAt` is left alone, since the server's answer may predate it.
 *
 * @param previews The server's standing previews.
 * @returns The previews of local sites it forgot, for the caller to tell a bought one from an ended one.
 */
export async function reconcilePreviews(
	userId: number,
	previews: PreviewSite[],
	checkedAt: number,
	options: { keepMissing?: boolean; hostedSites?: SyncSite[] } = {}
): Promise< Snapshot[] > {
	const standing = new Map(
		previews.map( ( preview ) => {
			const fields = previewFields( preview );
			return [ fields.atomicSiteId, fields ];
		} )
	);
	return updateConfig( ( config ) => {
		const forgotten: Snapshot[] = [];
		// The local site WordPress.com says a preview was made from, when it is a site here. WordPress.com
		// keeps it, so a preview whose record went missing, such as one whose first build failed, is
		// put back with its site rather than listed as made elsewhere.
		const localSiteIds = new Set( config.sites.map( ( site ) => site.id ) );
		const originOf = ( atomicSiteId: number ) => {
			const originId = previews.find( ( preview ) => Number( preview.id ) === atomicSiteId )
				?.originId;
			return originId && localSiteIds.has( originId ) ? originId : '';
		};
		config.snapshots = config.snapshots.filter( ( snapshot ) => {
			if (
				snapshot.userId !== userId ||
				! isWpcomPreview( snapshot ) ||
				snapshot.date > checkedAt
			) {
				return true;
			}
			const preview = standing.get( snapshot.atomicSiteId );
			if ( ! preview ) {
				if ( snapshot.localSiteId ) {
					forgotten.push( snapshot );
					if ( options.keepMissing ) return true;
					const hosted = options.hostedSites?.find(
						( candidate ) => candidate.id === snapshot.atomicSiteId
					);
					const local = config.sites.find( ( candidate ) => candidate.id === snapshot.localSiteId );
					if ( hosted && local ) {
						const connection = destinationConnection( local, 'wpcom', String( userId ), hosted.id );
						setRemoteSiteDetails( connection, 'wpcom', hosted );
					} else {
						forgetPreviewConnection( config, snapshot );
					}
				}
				return false;
			}
			snapshot.expiresAt = preview.expiresAt;
			snapshot.liveSiteId = preview.liveSiteId;
			snapshot.launchUrl = preview.launchUrl;
			if ( ! snapshot.localSiteId ) {
				snapshot.localSiteId = originOf( snapshot.atomicSiteId );
			}
			if ( preview.shareUrl ) {
				snapshot.shareUrl = preview.shareUrl;
			}
			return true;
		} );
		const listed = new Set( config.snapshots.map( ( snapshot ) => snapshot.atomicSiteId ) );
		for ( const [ atomicSiteId, preview ] of standing ) {
			if ( listed.has( atomicSiteId ) ) {
				continue;
			}
			// Made elsewhere, or its record here went missing. With no local site here it can still be
			// opened, shared and deleted.
			const { title } = previews.find( ( listed ) => Number( listed.id ) === atomicSiteId ) ?? {};
			config.snapshots.push( {
				...preview,
				...( title && { name: title } ),
				localSiteId: originOf( atomicSiteId ),
				date: checkedAt,
				userId,
			} );
		}
		return forgotten;
	} );
}
