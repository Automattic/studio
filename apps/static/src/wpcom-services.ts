import { SNAPSHOT_EVENTS, type SnapshotEvent } from '@studio/common/lib/cli-events';
import { fetchSnapshotUsage } from '@studio/common/lib/snapshots';
import { fetchStudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';
import { fetchStudioAssistantTopUpPricing } from '@studio/common/lib/studio-assistant-top-up-pricing';
import { SyncCancelledError } from '@studio/common/lib/sync/cancel';
import { SYNC_POLL_INTERVAL_MS } from '@studio/common/lib/sync/constants';
import {
	fetchHostingPhpVersion,
	fetchLatestRewindId,
	fetchRemoteFileTreeContents,
	fetchSyncableSites,
	initiateBackup,
	initiateImport,
	pollBackupStatus,
	pollImportStatus,
} from '@studio/common/lib/sync/sync-api';
import { withWpcomDetails } from '@studio/common/lib/sync/transform-sites';
import { createTusUpload } from '@studio/common/lib/sync/tus-upload';
import { __ } from '@wordpress/i18n';
import { buildPushArchive, exportSiteZip, importBackup } from './site-data';
import { kvGet, kvUpdate } from './store';
import type { StaticSites } from './sites';
import type {
	Snapshot,
	SnapshotUsage,
	StudioAssistantQuota,
	StudioAssistantTopUpPricing,
	SyncSite,
} from './types';
import type { WpcomAuth } from './wpcom-auth';
import type { SyncActivity, SyncEvent } from '@studio/common/lib/sync/activity';
import type { PullSyncOptions, PushSyncOptions } from '@studio/common/types/sync';

type SyncConnectListener = ( event: {
	remoteSiteId: number;
	studioSiteId: string;
	autoOpenPush?: boolean;
} ) => void;

const PREVIEW_STATUS_ACTIVE = '2';
const PREVIEW_MAX_POLLS = 100;
const PUBLISH_WATCH_ATTEMPTS = 60;
const PUBLISH_WATCH_INTERVAL_MS = 5_000;

const sleep = ( ms: number ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );

// Push, pull and preview sites talk to WordPress.com straight from the page
// with the user's token, through the same endpoints the Studio CLI uses.
// Connections and the preview-site list stay in this browser, as the CLI keeps
// them in its own config.
export class WpcomServices {
	private readonly syncListeners = new Set< ( event: SyncEvent ) => void >();
	private readonly snapshotListeners = new Set< ( event: SnapshotEvent ) => void >();
	private readonly connectListeners = new Set< SyncConnectListener >();
	private readonly cancellations = new Map< string, AbortController >();
	private readonly publishWatches = new Map< string, AbortController >();

	constructor(
		private readonly auth: WpcomAuth,
		private readonly sites: StaticSites
	) {}

	emitSyncActivity( siteId: string, activity: SyncActivity ) {
		this.syncListeners.forEach( ( listener ) => listener( { siteId, activity } ) );
	}

	onSyncActivity( listener: ( event: SyncEvent ) => void ) {
		this.syncListeners.add( listener );
		return () => this.syncListeners.delete( listener );
	}

	onSnapshotEvent( listener: ( event: SnapshotEvent ) => void ) {
		this.snapshotListeners.add( listener );
		return () => this.snapshotListeners.delete( listener );
	}

	onSyncConnectSite( listener: SyncConnectListener ) {
		this.connectListeners.add( listener );
		return () => this.connectListeners.delete( listener );
	}

	private emitSnapshot( event: SnapshotEvent ) {
		this.snapshotListeners.forEach( ( listener ) => listener( event ) );
	}

	private async userKey( prefix: string ): Promise< string | null > {
		const user = await this.auth.user();
		return user ? `${ prefix }:${ user.id }` : null;
	}

	// --- AI credits ---------------------------------------------------------

	async getQuota(): Promise< StudioAssistantQuota | null > {
		const token = await this.auth.token();
		return token ? fetchStudioAssistantQuota( token.accessToken ) : null;
	}

	async getTopUpPricing( locale?: string ): Promise< StudioAssistantTopUpPricing | null > {
		const token = await this.auth.token();
		return token ? fetchStudioAssistantTopUpPricing( token.accessToken, locale ) : null;
	}

	// --- Preview sites ------------------------------------------------------

	async getSnapshots(): Promise< Snapshot[] > {
		const key = await this.userKey( 'snapshots' );
		return key ? ( await kvGet< Snapshot[] >( key ) ) ?? [] : [];
	}

	private async updateSnapshots( update: ( snapshots: Snapshot[] ) => Snapshot[] ) {
		const key = await this.userKey( 'snapshots' );
		if ( key ) {
			await kvUpdate< Snapshot[] >( key, [], update );
		}
	}

	async getSnapshotUsage(): Promise< SnapshotUsage | null > {
		const token = await this.auth.token();
		return token ? fetchSnapshotUsage( token.accessToken ).catch( () => null ) : null;
	}

	async publishPreview(
		siteId: string,
		existingHostname?: string,
		name?: string
	): Promise< { url: string } > {
		const existing = existingHostname
			? ( await this.getSnapshots() ).find( ( snapshot ) => snapshot.url === existingHostname )
			: undefined;
		this.emitSyncActivity( siteId, {
			kind: 'pending',
			direction: 'preview',
			message: __( 'Creating archive…' ),
			...( existingHostname ? { hostname: existingHostname } : {} ),
		} );
		try {
			const zip = await exportSiteZip( await this.sites.client( siteId ), {
				standalone: true,
			} );
			this.emitSyncActivity( siteId, {
				kind: 'pending',
				direction: 'preview',
				message: __( 'Uploading site…' ),
				...( existingHostname ? { hostname: existingHostname } : {} ),
			} );
			const form = new FormData();
			form.append(
				'import',
				new Blob( [ zip as BlobPart ], { type: 'application/zip' } ),
				'local-env-site-1.zip'
			);
			if ( existing ) {
				form.append( 'site_id', String( existing.atomicSiteId ) );
			}
			const created = await this.auth.request< { domain_name: string; atomic_site_id: number } >(
				`/wpcom/v2/jurassic-ninja/${
					existing ? 'update-site-from-zip' : 'create-new-site-from-zip'
				}`,
				{ method: 'POST', body: form }
			);
			this.emitSyncActivity( siteId, {
				kind: 'pending',
				direction: 'preview',
				message: __( 'Setting up the preview site…' ),
				hostname: created.domain_name,
			} );
			for ( let attempt = 0; ; attempt++ ) {
				const { status } = await this.auth.request< { status: string } >(
					`/wpcom/v2/jurassic-ninja/status?site_id=${ created.atomic_site_id }`
				);
				if ( String( status ) === PREVIEW_STATUS_ACTIVE ) {
					break;
				}
				if ( attempt + 1 >= PREVIEW_MAX_POLLS ) {
					throw new Error( __( 'The preview site did not finish setting up. Try again later.' ) );
				}
				await sleep( SYNC_POLL_INTERVAL_MS );
			}
			const user = await this.auth.user();
			const snapshot: Snapshot = {
				url: created.domain_name,
				atomicSiteId: created.atomic_site_id,
				localSiteId: siteId,
				date: Date.now(),
				name: name ?? existing?.name,
				userId: user?.id,
			};
			await this.updateSnapshots( ( snapshots ) => [
				...snapshots.filter( ( candidate ) => candidate.url !== snapshot.url ),
				snapshot,
			] );
			this.emitSnapshot( {
				event: existing ? SNAPSHOT_EVENTS.UPDATED : SNAPSHOT_EVENTS.CREATED,
				snapshot,
				snapshotUrl: snapshot.url,
			} );
			this.emitSyncActivity( siteId, { kind: 'success', direction: 'preview' } );
			return { url: `https://${ snapshot.url }` };
		} catch ( error ) {
			this.emitSyncActivity( siteId, {
				kind: 'error',
				direction: 'preview',
				message: error instanceof Error ? error.message : String( error ),
			} );
			throw error;
		}
	}

	async deleteSnapshot( hostname: string ): Promise< void > {
		const snapshot = ( await this.getSnapshots() ).find(
			( candidate ) => candidate.url === hostname
		);
		if ( snapshot ) {
			await this.auth
				.request( '/wpcom/v2/jurassic-ninja/delete', {
					method: 'POST',
					body: JSON.stringify( { site_id: snapshot.atomicSiteId } ),
				} )
				.catch( ( error: Error ) => {
					if ( ! /already.deleted/i.test( error.message ) ) {
						throw error;
					}
				} );
		}
		await this.updateSnapshots( ( snapshots ) =>
			snapshots.filter( ( candidate ) => candidate.url !== hostname )
		);
		this.emitSnapshot( { event: SNAPSHOT_EVENTS.DELETED, snapshot, snapshotUrl: hostname } );
	}

	async deleteAllSnapshots(): Promise< void > {
		await this.auth.request( '/wpcom/v2/jurassic-ninja/delete/all', { method: 'POST' } );
		await this.updateSnapshots( () => [] );
		this.emitSnapshot( { event: SNAPSHOT_EVENTS.DELETED_ALL } );
	}

	async renameSnapshot( hostname: string, name: string ): Promise< void > {
		let renamed: Snapshot | undefined;
		await this.updateSnapshots( ( snapshots ) =>
			snapshots.map( ( snapshot ) => {
				if ( snapshot.url !== hostname ) {
					return snapshot;
				}
				renamed = { ...snapshot, name };
				return renamed;
			} )
		);
		this.emitSnapshot( {
			event: SNAPSHOT_EVENTS.UPDATED,
			snapshot: renamed,
			snapshotUrl: hostname,
		} );
	}

	// --- Connections --------------------------------------------------------

	private async connections(): Promise< SyncSite[] > {
		const key = await this.userKey( 'connections' );
		return key ? ( await kvGet< SyncSite[] >( key ) ) ?? [] : [];
	}

	private async updateConnections( update: ( connections: SyncSite[] ) => SyncSite[] ) {
		const key = await this.userKey( 'connections' );
		if ( key ) {
			await kvUpdate< SyncSite[] >( key, [], update );
		}
	}

	async fetchSyncableSites(): Promise< SyncSite[] > {
		const token = await this.auth.token();
		if ( ! token ) {
			return [];
		}
		const connectedSiteIds = ( await this.connections() ).map( ( site ) => site.id );
		return fetchSyncableSites( token.accessToken, connectedSiteIds );
	}

	async getConnectedSites( localSiteId?: string ): Promise< SyncSite[] > {
		const connections = ( await this.connections() ).filter(
			( site ) => ! localSiteId || site.localSiteId === localSiteId
		);
		if ( ! connections.length ) {
			return [];
		}
		const wpcomSites = await this.fetchSyncableSites().catch( () => null );
		return wpcomSites ? withWpcomDetails( connections, wpcomSites ) : connections;
	}

	// After the publish checkout creates a WordPress.com site, finds it among
	// the account's sites (polling for about five minutes) and offers to push.
	async watchForPublishedSite( siteId: string ): Promise< void > {
		this.publishWatches.get( siteId )?.abort();
		const watch = new AbortController();
		this.publishWatches.set( siteId, watch );
		const name = ( await this.sites.get( siteId ) ).name.toLowerCase();
		const knownIds = new Set( ( await this.fetchSyncableSites() ).map( ( site ) => site.id ) );
		void ( async () => {
			for ( let attempt = 0; attempt < PUBLISH_WATCH_ATTEMPTS; attempt++ ) {
				await sleep( PUBLISH_WATCH_INTERVAL_MS );
				if ( watch.signal.aborted ) {
					return;
				}
				const fresh = await this.fetchSyncableSites()
					.then( ( sites ) => sites.filter( ( site ) => ! knownIds.has( site.id ) ) )
					.catch( () => [] );
				const match =
					fresh.find(
						( site ) =>
							!! name &&
							( site.name.toLowerCase().includes( name ) ||
								site.url.toLowerCase().includes( name ) )
					) ?? ( fresh.length === 1 ? fresh[ 0 ] : undefined );
				if ( match && ! watch.signal.aborted ) {
					this.publishWatches.delete( siteId );
					this.connectListeners.forEach( ( listener ) =>
						listener( { remoteSiteId: match.id, studioSiteId: siteId, autoOpenPush: true } )
					);
					return;
				}
			}
			this.publishWatches.delete( siteId );
		} )();
	}

	async connectSite( localSiteId: string, site: SyncSite ): Promise< void > {
		await this.updateConnections( ( connections ) => [
			...connections.filter(
				( candidate ) => ! ( candidate.id === site.id && candidate.localSiteId === localSiteId )
			),
			{ ...site, localSiteId },
		] );
	}

	async disconnectSite( localSiteId: string, remoteSiteId: number ): Promise< void > {
		await this.updateConnections( ( connections ) =>
			connections.filter(
				( site ) => ! ( site.id === remoteSiteId && site.localSiteId === localSiteId )
			)
		);
	}

	private async recordSync( localSiteId: string, remoteSiteId: number, field: 'push' | 'pull' ) {
		const timestamp = new Date().toISOString();
		await this.updateConnections( ( connections ) =>
			connections.map( ( site ) =>
				site.id === remoteSiteId && site.localSiteId === localSiteId
					? {
							...site,
							...( field === 'push'
								? { lastPushTimestamp: timestamp }
								: { lastPullTimestamp: timestamp } ),
					  }
					: site
			)
		);
	}

	// --- Push and pull ------------------------------------------------------

	private beginSync( siteId: string, remoteSiteId: number ): AbortSignal {
		const controller = new AbortController();
		this.cancellations.set( `${ siteId }:${ remoteSiteId }`, controller );
		return controller.signal;
	}

	async cancelSync( siteId: string, remoteSiteId: number ): Promise< void > {
		this.cancellations.get( `${ siteId }:${ remoteSiteId }` )?.abort();
	}

	private async runSync(
		siteId: string,
		remoteSiteId: number,
		direction: 'push' | 'pull',
		run: ( signal: AbortSignal ) => Promise< void >
	) {
		const signal = this.beginSync( siteId, remoteSiteId );
		try {
			await run( signal );
			await this.recordSync( siteId, remoteSiteId, direction );
			this.emitSyncActivity( siteId, { kind: 'success', direction } );
		} catch ( error ) {
			if ( signal.aborted ) {
				this.emitSyncActivity( siteId, { kind: 'cancelled', direction } );
				throw new SyncCancelledError();
			}
			this.emitSyncActivity( siteId, {
				kind: 'error',
				direction,
				message: error instanceof Error ? error.message : String( error ),
			} );
			throw error;
		} finally {
			this.cancellations.delete( `${ siteId }:${ remoteSiteId }` );
		}
	}

	async push( siteId: string, remoteSiteId: number, options?: PushSyncOptions ): Promise< void > {
		const optionsToSync = options?.optionsToSync ?? [ 'all' ];
		const all = optionsToSync.includes( 'all' );
		const contentOptions = [ 'uploads', 'plugins', 'themes', 'contents' ] as const;
		await this.runSync( siteId, remoteSiteId, 'push', async ( signal ) => {
			const progress = (
				phase: 'creatingBackup' | 'uploading' | 'applyingChanges',
				value: number,
				message: string
			) =>
				this.emitSyncActivity( siteId, {
					kind: 'pending',
					direction: 'push',
					phase,
					progress: value,
					message,
					remoteSiteId,
				} );
			progress( 'creatingBackup', 5, __( 'Creating backup…' ) );
			const archive = await buildPushArchive( await this.sites.client( siteId ), {
				database: all || optionsToSync.includes( 'sqls' ),
				wpContent: all || contentOptions.some( ( option ) => optionsToSync.includes( option ) ),
				paths: options?.specificSelectionPaths,
			} );
			signal.throwIfAborted();
			progress( 'uploading', 20, __( 'Uploading…' ) );
			const attachmentId = await this.uploadArchive(
				remoteSiteId,
				new Blob( [ archive as BlobPart ], { type: 'application/gzip' } ),
				`push-${ siteId }-${ Date.now() }.tar.gz`,
				signal,
				( percent ) => progress( 'uploading', 20 + percent * 0.2, __( 'Uploading…' ) )
			);
			const token = await this.auth.requireToken();
			await initiateImport( token, remoteSiteId, attachmentId, {
				optionsToSync,
				specificSelectionPaths: options?.specificSelectionPaths,
			} );
			for (;;) {
				signal.throwIfAborted();
				await sleep( SYNC_POLL_INTERVAL_MS );
				const status = await pollImportStatus( token, remoteSiteId );
				if ( status.status === 'failed' || ! status.success ) {
					throw new Error(
						( status.status === 'failed' && status.error ) ||
							__( 'WordPress.com could not import the site.' )
					);
				}
				if ( status.status === 'finished' ) {
					return;
				}
				const importing = status.status.startsWith( 'archive_import' );
				progress(
					'applyingChanges',
					importing
						? 60 + ( status.import_progress ?? 0 ) * 0.39
						: 40 + ( status.backup_progress ?? 0 ) * 0.2,
					importing ? __( 'Applying changes…' ) : __( 'Backing up the live site…' )
				);
			}
		} );
	}

	private async uploadArchive(
		remoteSiteId: number,
		file: Blob,
		filename: string,
		signal: AbortSignal,
		onProgress: ( percent: number ) => void
	): Promise< string > {
		const upload = createTusUpload( {
			token: await this.auth.requireToken(),
			remoteSiteId,
			file,
			filename,
			onProgress,
		} );
		signal.addEventListener( 'abort', upload.abort );
		try {
			return await upload.promise;
		} catch ( error ) {
			throw signal.aborted ? new SyncCancelledError() : error;
		}
	}

	async pull( siteId: string, remoteSiteId: number, options?: PullSyncOptions ): Promise< void > {
		await this.runSync( siteId, remoteSiteId, 'pull', async ( signal ) => {
			const progress = ( value: number, message: string ) =>
				this.emitSyncActivity( siteId, {
					kind: 'pending',
					direction: 'pull',
					progress: value,
					message,
					remoteSiteId,
				} );
			progress( 0, __( 'Requesting a backup…' ) );
			const token = await this.auth.requireToken();
			const backupId = await initiateBackup( token, remoteSiteId, {
				optionsToSync: options?.optionsToSync ?? [ 'all' ],
				includePathList: options?.includePathList?.length ? options.includePathList : undefined,
			} );
			let downloadUrl: string | null = null;
			while ( ! downloadUrl ) {
				signal.throwIfAborted();
				await sleep( SYNC_POLL_INTERVAL_MS );
				const status = await pollBackupStatus( token, remoteSiteId, backupId );
				if ( status.status === 'failed' ) {
					throw new Error( __( 'WordPress.com could not back up the site.' ) );
				}
				if ( status.status === 'finished' && status.downloadUrl ) {
					downloadUrl = status.downloadUrl;
				} else {
					progress( status.percent * 0.5, __( 'Backing up the live site…' ) );
				}
			}
			progress( 50, __( 'Downloading…' ) );
			const response = await fetch( downloadUrl, { signal } );
			if ( ! response.ok ) {
				throw new Error( __( 'The backup could not be downloaded.' ) );
			}
			const bytes = new Uint8Array( await response.arrayBuffer() );
			signal.throwIfAborted();
			progress( 80, __( 'Importing…' ) );
			await importBackup( await this.sites.client( siteId ), 'pull.tar.gz', bytes );
		} );
	}

	async getLatestRewindId( remoteSiteId: number ): Promise< string | null > {
		return fetchLatestRewindId( await this.auth.requireToken(), remoteSiteId );
	}

	async listRemoteFileTree(
		remoteSiteId: number,
		rewindId: string,
		path: string
	): Promise< Record< string, unknown > > {
		return fetchRemoteFileTreeContents(
			await this.auth.requireToken(),
			remoteSiteId,
			rewindId,
			path
		);
	}

	async getHostingPhpVersion( remoteSiteId: number ): Promise< string | undefined > {
		return fetchHostingPhpVersion( await this.auth.requireToken(), remoteSiteId );
	}
}
