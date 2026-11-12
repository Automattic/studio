import { readProviderConfig } from '@studio/common/lib/provider-config';
import { rememberRemoteSite } from '@studio/common/lib/remote-sites';
import { isReprintPullEnabled } from '@studio/common/lib/sync/reprint-pull';
import type { Provider, ProviderConfigs, ProviderSites, SitesProviderId } from '@studio/providers';

// The remote-site operations every host runs the same way. Hosts pass in the provider, from
// `@studio/providers/services`, which `@studio/common` doesn't import.

type SitesProvider< Id extends SitesProviderId > = Provider<
	ProviderConfigs[ Id ],
	ProviderSites[ Id ]
>;

function sites< Id extends SitesProviderId >( provider: SitesProvider< Id > ) {
	if ( ! provider.sites ) {
		throw new Error( `${ provider.descriptor.label } has no sites.` );
	}
	return provider.sites;
}

// The sites the account can connect a local site to.
export async function listAccountSites< Id extends SitesProviderId >(
	provider: SitesProvider< Id >
): Promise< ProviderSites[ Id ][] > {
	const config = await readProviderConfig( provider.descriptor.id as Id );
	return sites( provider ).list( config, { planRequired: ! isReprintPullEnabled() } );
}

// Creates a site on the provider and connects the local site to it.
export async function createRemoteSite< Id extends SitesProviderId >(
	provider: SitesProvider< Id >,
	localSiteId: string,
	name: string
): Promise< ProviderSites[ Id ] > {
	const id = provider.descriptor.id as Id;
	const create = sites( provider ).create;
	if ( ! create ) {
		throw new Error( `Studio can't create ${ provider.descriptor.label } sites.` );
	}
	const site = await create( await readProviderConfig( id ), { name } );
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
		throw new Error( `${ provider.descriptor.label } sites can't be pulled.` );
	}
	return pull.latestBackupId( await readProviderConfig( provider.descriptor.id as Id ), {
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
		throw new Error( `${ provider.descriptor.label } sites can't be pulled.` );
	}
	return pull.listBackupFiles(
		await readProviderConfig( provider.descriptor.id as Id ),
		{ id: remoteSiteId },
		backupId,
		path
	);
}
