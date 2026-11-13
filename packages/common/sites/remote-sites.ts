import { getProvider } from '@studio/providers';
import { forgetRejectedConfig, readProviderConfig } from '@studio/common/lib/provider-config';
import { rememberRemoteSite } from '@studio/common/lib/remote-sites';
import { isReprintPullEnabled } from '@studio/common/lib/sync/reprint-pull';
import type {
	ProviderConfigs,
	ProviderServices,
	ProviderSites,
	SitesProviderId,
} from '@studio/providers';

// The remote-site operations every host runs the same way. Hosts pass in the provider, from
// `@studio/providers/services`, which `@studio/common` doesn't import.

type SitesProvider< Id extends SitesProviderId > = ProviderServices<
	ProviderConfigs[ Id ],
	ProviderSites[ Id ]
>;

function sites< Id extends SitesProviderId >( provider: SitesProvider< Id > ) {
	if ( ! provider.sites ) {
		throw new Error( `${ getProvider( provider.id ).label } has no sites.` );
	}
	return provider.sites;
}

// The sites the account can connect a local site to.
export async function listAccountSites< Id extends SitesProviderId >(
	provider: SitesProvider< Id >
): Promise< ProviderSites[ Id ][] > {
	const id = provider.id as Id;
	return forgetRejectedConfig( id, async () =>
		sites( provider ).list( await readProviderConfig( id ), {
			planRequired: ! isReprintPullEnabled(),
		} )
	);
}

// Creates a site on the provider and connects the local site to it.
export async function createRemoteSite< Id extends SitesProviderId >(
	provider: SitesProvider< Id >,
	localSiteId: string,
	name: string
): Promise< ProviderSites[ Id ] > {
	const id = provider.id as Id;
	const create = sites( provider ).create;
	if ( ! create ) {
		throw new Error( `Studio can't create ${ getProvider( provider.id ).label } sites.` );
	}
	const site = await forgetRejectedConfig( id, async () =>
		create( await readProviderConfig( id ), { name } )
	);
	await rememberRemoteSite( id, localSiteId, site );
	return site;
}

// What a selective pull needs: the latest backup, and the files in it.
export async function getRemoteBackupId< Id extends SitesProviderId >(
	provider: SitesProvider< Id >,
	remoteSiteId: ProviderSites[ Id ][ 'id' ]
): Promise< string > {
	const pull = sites( provider ).pull;
	if ( ! pull ) {
		throw new Error( `${ getProvider( provider.id ).label } sites can't be pulled.` );
	}
	return pull.latestBackupId( await readProviderConfig( provider.id as Id ), {
		id: remoteSiteId,
	} );
}

export async function listRemoteBackupFiles< Id extends SitesProviderId >(
	provider: SitesProvider< Id >,
	remoteSiteId: ProviderSites[ Id ][ 'id' ],
	backupId: string,
	path: string
): Promise< Record< string, unknown > > {
	const pull = sites( provider ).pull;
	if ( ! pull ) {
		throw new Error( `${ getProvider( provider.id ).label } sites can't be pulled.` );
	}
	return pull.listBackupFiles(
		await readProviderConfig( provider.id as Id ),
		{ id: remoteSiteId },
		backupId,
		path
	);
}

export async function getSiteVisibility< Id extends SitesProviderId >(
	provider: SitesProvider< Id >,
	id: ProviderSites[ Id ][ 'id' ]
) {
	const capability = sites( provider ).visibility;
	if ( ! capability ) throw new Error( 'This provider does not support visibility settings.' );
	return capability.get( await readProviderConfig( provider.id as Id ), id );
}
export async function setSiteVisibility< Id extends SitesProviderId >(
	provider: SitesProvider< Id >,
	id: ProviderSites[ Id ][ 'id' ],
	value: import('@studio/providers').SiteVisibility
) {
	const capability = sites( provider ).visibility;
	if ( ! capability ) throw new Error( 'This provider does not support visibility settings.' );
	return capability.set( await readProviderConfig( provider.id as Id ), id, value );
}
