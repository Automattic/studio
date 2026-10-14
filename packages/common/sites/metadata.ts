import { z } from 'zod';
import { readAppConfig, updateAppConfig } from '@studio/common/lib/app-config';
import { listSites } from './list';
import type { SiteListItem } from '@studio/common/lib/cli-events';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';

// Studio-owned per-site fields kept in `app.json` (`siteMetadata[id]`), which
// the CLI's `site list` doesn't carry. Parsed rather than cast so malformed
// metadata can't throw, and `.loose()` so fields a newer desktop adds survive
// a write.

const siteMetadataFields = z.object( {
	sortOrder: z.number().optional().catch( undefined ),
	autoStart: z.boolean().optional().catch( undefined ),
} );

const siteMetadataRecordSchema = z
	.record( z.string(), siteMetadataFields.loose().catch( {} ) )
	.catch( {} );

export type SiteMetadata = z.infer< typeof siteMetadataFields >;

export async function readSiteMetadata(): Promise< Record< string, SiteMetadata > > {
	return siteMetadataRecordSchema.parse( ( await readAppConfig() ).siteMetadata );
}

/** Merge each patch into its site's metadata; `null` removes the site's entry. */
export async function updateSiteMetadata(
	patches: Record< string, Partial< SiteMetadata > | null >
): Promise< void > {
	await updateAppConfig( ( config ) => {
		const siteMetadata = siteMetadataRecordSchema.parse( config.siteMetadata );
		for ( const [ siteId, patch ] of Object.entries( patches ) ) {
			if ( patch ) {
				siteMetadata[ siteId ] = { ...siteMetadata[ siteId ], ...patch };
			} else {
				delete siteMetadata[ siteId ];
			}
		}
		config.siteMetadata = siteMetadata;
	} );
}

/** The CLI's site list, with each site's Studio-owned metadata merged in. */
export async function listSitesWithMetadata(
	execute: ExecuteCliCommand
): Promise< ( SiteListItem & SiteMetadata )[] > {
	const [ sites, metadata ] = await Promise.all( [ listSites( execute ), readSiteMetadata() ] );
	return sites.map( ( site ) => {
		const { sortOrder, autoStart } = metadata[ site.id ] ?? {};
		return { ...site, sortOrder, autoStart };
	} );
}
