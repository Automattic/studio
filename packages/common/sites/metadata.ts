import { z } from 'zod';
import { updateConfig } from '@studio/common/lib/config/store';
import { updateConfigAndMuPluginSettings } from '@studio/common/lib/mu-plugin-settings';
import { readSite } from './site-path';
import type { SiteDetails } from '@studio/common/lib/cli-events';

// Studio's own per-site settings, kept on the site's record in the config file.
export type SiteMetadata = Pick< SiteDetails, 'sortOrder' | 'autoStart' | 'hideFrontendAdminBar' >;

/** Merge each patch into its site's settings. */
export async function updateSiteMetadata(
	patches: Record< string, Partial< SiteMetadata > >
): Promise< void > {
	const changesAdminBar = Object.values( patches ).some(
		( patch ) => 'hideFrontendAdminBar' in patch
	);
	const update = changesAdminBar ? updateConfigAndMuPluginSettings : updateConfig;
	await update( ( { sites } ) => {
		for ( const site of sites ) {
			Object.assign( site, patches[ site.id ] );
		}
	} );
}

export async function setSiteFrontendAdminBar(
	siteId: string,
	hidden: boolean | null
): Promise< void > {
	const value = z.boolean().nullable().parse( hidden );
	if ( ! ( await readSite( siteId ) ) ) {
		throw new Error( 'Site not found.' );
	}
	await updateSiteMetadata( { [ siteId ]: { hideFrontendAdminBar: value ?? undefined } } );
}
