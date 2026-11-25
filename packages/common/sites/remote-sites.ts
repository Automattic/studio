import { getProvider } from '@studio/providers';
import { forgetRejectedConfig, readProviderConfig } from '@studio/common/lib/provider-config';
import { rememberRemoteSite } from '@studio/common/lib/remote-sites';
import { isReprintPullEnabled } from '@studio/common/lib/sync/reprint-pull';
import type {
	NewSite,
	ProviderConfigs,
	ProviderServices,
	ProviderSites,
	ResolveFrom,
	SiteCreationVisibility,
	SiteVisibility,
	SitesProviderId,
} from '@studio/providers';

// The remote-site operations every host runs the same way. Hosts pass in the provider, from
// `@studio/providers/services`, which `@studio/common` doesn't import.

type Site = ProviderSites[ SitesProviderId ];
type SitesProvider = ProviderServices< ProviderConfigs[ SitesProviderId ], Site >;

const config = ( provider: SitesProvider ) => readProviderConfig( provider.id as SitesProviderId );

function sites( provider: SitesProvider ) {
	if ( ! provider.sites ) {
		throw new Error( `${ getProvider( provider.id ).label } has no sites.` );
	}
	return provider.sites;
}

// The sites the account can connect a local site to.
export async function listAccountSites( provider: SitesProvider ): Promise< Site[] > {
	const id = provider.id as SitesProviderId;
	return forgetRejectedConfig( id, async () =>
		sites( provider ).list( await readProviderConfig( id ), {
			planRequired: ! isReprintPullEnabled(),
		} )
	);
}

export async function getSiteCreationVisibility(
	provider: SitesProvider,
	input?: NewSite[ 'input' ]
): Promise< SiteCreationVisibility | null > {
	const id = provider.id as SitesProviderId;
	const creationVisibility = sites( provider ).creationVisibility;
	if ( ! creationVisibility ) {
		return null;
	}
	return forgetRejectedConfig( id, async () =>
		creationVisibility( await readProviderConfig( id ), input )
	);
}

// Creates a site on the provider and connects the local site to it.
export async function createRemoteSite(
	provider: SitesProvider,
	localSiteId: string,
	{ name, visibility, input }: NewSite,
	connect = true
): Promise< Site > {
	if ( visibility !== undefined && visibility !== 'public' && visibility !== 'private' ) {
		throw new Error( 'Invalid visibility for a new site.' );
	}
	const id = provider.id as SitesProviderId;
	const create = sites( provider ).create;
	if ( ! create ) {
		throw new Error( `Studio can't create ${ getProvider( provider.id ).label } sites.` );
	}
	const site = await forgetRejectedConfig( id, async () =>
		create( await readProviderConfig( id ), { name, visibility, input } )
	);
	if ( connect ) await rememberRemoteSite( id, localSiteId, site );
	return site;
}

// The site with that id, or the one the provider's `connect` form describes, once the provider
// reached it.
export async function resolveRemoteSite(
	provider: SitesProvider,
	from: ResolveFrom
): Promise< Site > {
	const resolve = sites( provider ).resolve;
	if ( ! resolve ) {
		throw new Error( `Studio can't connect ${ getProvider( provider.id ).label } sites by form.` );
	}
	return resolve( await config( provider ), from );
}

// Runs an action the provider's connect form asks for, such as listing the user's SSH hosts.
export async function runSitesAction(
	provider: SitesProvider,
	action: string,
	input: Record< string, string >
): Promise< unknown > {
	const run = sites( provider ).action;
	if ( ! run ) {
		throw new Error( `${ getProvider( provider.id ).label } has no actions.` );
	}
	return run( await config( provider ), action, input );
}

// What a selective pull needs: the latest backup, and the files in it.
export async function getRemoteBackupId(
	provider: SitesProvider,
	remoteSiteId: Site[ 'id' ]
): Promise< string > {
	const pull = sites( provider ).pull;
	if ( ! pull ) {
		throw new Error( `${ getProvider( provider.id ).label } sites can't be pulled.` );
	}
	return pull.latestBackupId( await config( provider ), {
		id: remoteSiteId,
	} );
}

export async function listRemoteBackupFiles(
	provider: SitesProvider,
	remoteSiteId: Site[ 'id' ],
	backupId: string,
	path: string
): Promise< Record< string, unknown > > {
	const pull = sites( provider ).pull;
	if ( ! pull ) {
		throw new Error( `${ getProvider( provider.id ).label } sites can't be pulled.` );
	}
	return pull.listBackupFiles( await config( provider ), { id: remoteSiteId }, backupId, path );
}

export async function getSiteVisibility( provider: SitesProvider, id: Site[ 'id' ] ) {
	const capability = sites( provider ).visibility;
	if ( ! capability ) return null;
	return capability.get( await config( provider ), id );
}
export async function setSiteVisibility(
	provider: SitesProvider,
	id: Site[ 'id' ],
	value: SiteVisibility
) {
	const capability = sites( provider ).visibility;
	if ( ! capability ) throw new Error( 'This provider does not support visibility settings.' );
	return capability.set( await config( provider ), id, value );
}
