import type { SiteDetails } from '@/data/core';

export type ConnectSiteStage = 'create' | 'connect' | 'pull' | 'open';

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
