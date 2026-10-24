import { TRACKS_EVENTS } from '@studio/common/lib/record-tracks-event';
import { classifySyncFailure } from '@studio/common/lib/sync/classify-sync-failure';
import { useNavigate } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { useCreateSite, useDeleteSite, useStartSite } from '@/data/queries/use-sites';
import { usePullSiteFromLive } from '@/data/queries/use-sync-site';
import { requestHeaderPanel } from '@/features/sites/use-open-header-panel';
import { useAddSite } from './context';
import type { CreateSiteParams, SiteDetails, SyncSite } from '@/data/core';

type ConnectSiteStage = 'create' | 'connect' | 'pull' | 'open';

interface ConnectSiteLifecycle {
	createLocalSite: () => Promise< SiteDetails >;
	persistConnection: ( localSiteId: string ) => Promise< void >;
	pullRemoteSite: ( localSiteId: string ) => Promise< void >;
	startLocalSite: ( localSiteId: string ) => Promise< void >;
	openLocalSite: ( localSiteId: string ) => Promise< void >;
	deleteLocalSite: ( localSiteId: string ) => Promise< void >;
	onStage?: ( stage: ConnectSiteStage ) => void;
}

export class ConnectSiteLifecycleError extends Error {
	readonly connectionPersisted: boolean;
	readonly localSiteId: string | undefined;

	constructor( error: unknown, connectionPersisted: boolean, localSiteId?: string ) {
		super( error instanceof Error ? error.message : 'Failed to connect site.' );
		this.name = 'ConnectSiteLifecycleError';
		this.connectionPersisted = connectionPersisted;
		this.localSiteId = localSiteId;
	}
}

export async function runConnectSiteLifecycle( {
	createLocalSite,
	persistConnection,
	pullRemoteSite,
	startLocalSite,
	openLocalSite,
	deleteLocalSite,
	onStage,
}: ConnectSiteLifecycle ): Promise< SiteDetails > {
	let localSite: SiteDetails | undefined;
	let connectionPersisted = false;

	try {
		onStage?.( 'create' );
		localSite = await createLocalSite();
		onStage?.( 'connect' );
		await persistConnection( localSite.id );
		connectionPersisted = true;

		const localSiteId = localSite.id;
		onStage?.( 'pull' );
		void ( async () => {
			try {
				await pullRemoteSite( localSiteId );
			} catch {
				return;
			}
			await startLocalSite( localSiteId ).catch( () => undefined );
		} )();
		onStage?.( 'open' );
		await openLocalSite( localSiteId );
		return localSite;
	} catch ( error ) {
		if ( localSite && ! connectionPersisted ) {
			await deleteLocalSite( localSite.id ).catch( () => undefined );
		}
		throw new ConnectSiteLifecycleError( error, connectionPersisted, localSite?.id );
	}
}

/**
 * Creates the local site for a remote one and connects it, then opens it while
 * the pull runs in the background, in its Publish panel. A failure before the
 * connection is saved removes the local site and throws.
 */
export function useConnectSite() {
	const connector = useConnector();
	const navigate = useNavigate();
	const createSite = useCreateSite();
	const deleteSite = useDeleteSite();
	const pullSite = usePullSiteFromLive();
	const startSite = useStartSite();
	const { setProgress, pinNewSite } = useAddSite();

	return async ( remote: SyncSite, params: CreateSiteParams ) => {
		try {
			await runConnectSiteLifecycle( {
				createLocalSite: async () => {
					const site = await createSite.mutateAsync( {
						...params,
						skipStart: true,
						flowType: 'sync',
					} );
					pinNewSite( site.id );
					return site;
				},
				persistConnection: async ( localSiteId ) => {
					try {
						await connector.connectWpcomSite( localSiteId, {
							...remote,
							localSiteId,
							syncSupport: 'already-connected',
						} );
					} catch ( error ) {
						void connector.trackEvent( TRACKS_EVENTS.SYNC_CONNECT, {
							success: false,
							failure_reason: classifySyncFailure( error, { phase: 'storage_write' } ),
							num_of_sites: 0,
						} );
						throw error;
					}
					// The local site is created by this same flow, so it always ends up
					// with exactly this one connection.
					void connector.trackEvent( TRACKS_EVENTS.SYNC_CONNECT, {
						success: true,
						num_of_sites: 1,
					} );
				},
				pullRemoteSite: ( localSiteId ) =>
					pullSite.mutateAsync( {
						siteId: localSiteId,
						remoteSiteId: remote.id,
						// The local site is created by this flow, so the connected-sites
						// cache the hook would otherwise read has nothing for it yet.
						syncSite: remote,
					} ),
				startLocalSite: async ( localSiteId ) => {
					await startSite.mutateAsync( localSiteId );
				},
				openLocalSite: ( localSiteId ) => {
					requestHeaderPanel( { panel: 'publish', siteId: localSiteId, view: 'pull' } );
					return navigate( { to: '/sites/$siteId', params: { siteId: localSiteId } } );
				},
				deleteLocalSite: ( localSiteId ) =>
					deleteSite.mutateAsync( { id: localSiteId, deleteFiles: true } ),
				onStage: ( stage ) => {
					const messages = {
						create: __( 'Creating the local site…' ),
						connect: __( 'Saving the WordPress.com connection…' ),
						pull: __( 'Pulling the live site into WordPress Studio…' ),
						open: __( 'Opening the local site…' ),
					};
					setProgress( messages[ stage ] );
				},
			} );
		} catch ( error ) {
			if ( ! ( error instanceof ConnectSiteLifecycleError && error.connectionPersisted ) ) {
				throw error;
			}
			toast.error(
				__( 'Setup did not finish. The local site and WordPress.com connection were kept.' )
			);
			if ( error.localSiteId ) {
				await navigate( { to: '/sites/$siteId', params: { siteId: error.localSiteId } } );
			}
		}
	};
}
