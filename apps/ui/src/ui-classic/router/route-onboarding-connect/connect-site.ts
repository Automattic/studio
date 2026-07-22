import type { ProposedSitePath, SiteDetails } from '@/data/core';

export type ConnectSiteStage = 'create' | 'connect' | 'pull' | 'start' | 'open';

interface ConnectSiteLifecycle {
	createLocalSite: () => Promise< SiteDetails >;
	persistConnection: ( localSiteId: string ) => Promise< void >;
	pullRemoteSite: ( localSiteId: string ) => Promise< void >;
	startLocalSite: ( localSiteId: string ) => Promise< void >;
	openLocalSite: ( localSiteId: string ) => Promise< void >;
	deleteLocalSite: ( localSiteId: string ) => Promise< void >;
	onStage?: ( stage: ConnectSiteStage ) => void;
	backgroundAfterConnection?: boolean;
	onBackgroundError?: ( error: ConnectSiteLifecycleError ) => void;
}

export class ConnectSiteLifecycleError extends Error {
	readonly connectionPersisted: boolean;
	readonly localSiteId: string | undefined;
	readonly originalError: unknown;

	constructor( error: unknown, connectionPersisted: boolean, localSiteId?: string ) {
		super( error instanceof Error ? error.message : 'Failed to connect site.' );
		this.name = 'ConnectSiteLifecycleError';
		this.connectionPersisted = connectionPersisted;
		this.localSiteId = localSiteId;
		this.originalError = error;
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
	backgroundAfterConnection = false,
	onBackgroundError,
}: ConnectSiteLifecycle ): Promise< SiteDetails > {
	let localSite: SiteDetails | undefined;
	let connectionPersisted = false;

	try {
		onStage?.( 'create' );
		localSite = await createLocalSite();
		onStage?.( 'connect' );
		await persistConnection( localSite.id );
		connectionPersisted = true;

		if ( backgroundAfterConnection ) {
			const localSiteId = localSite.id;
			onStage?.( 'pull' );
			void ( async () => {
				try {
					await pullRemoteSite( localSiteId );
					await startLocalSite( localSiteId );
				} catch ( error ) {
					onBackgroundError?.( new ConnectSiteLifecycleError( error, true, localSiteId ) );
				}
			} )();
			onStage?.( 'open' );
			await openLocalSite( localSite.id );
			return localSite;
		}

		onStage?.( 'pull' );
		await pullRemoteSite( localSite.id );
		onStage?.( 'start' );
		await startLocalSite( localSite.id );
		onStage?.( 'open' );
		await openLocalSite( localSite.id );
		return localSite;
	} catch ( error ) {
		if ( localSite && ! connectionPersisted ) {
			await deleteLocalSite( localSite.id ).catch( () => undefined );
		}
		throw new ConnectSiteLifecycleError( error, connectionPersisted, localSite?.id );
	}
}

export async function findAvailableSitePath(
	baseName: string,
	generateProposedSitePath: ( name: string ) => Promise< ProposedSitePath >
): Promise< { name: string; path: string } > {
	for ( let suffix = 1; suffix <= 500; suffix++ ) {
		const name = suffix === 1 ? baseName : `${ baseName } ${ suffix }`;
		const pathInfo = await generateProposedSitePath( name );
		if ( pathInfo.isEmpty ) {
			return { name, path: pathInfo.path };
		}
	}
	throw new Error( 'Unable to find an available local site folder.' );
}
