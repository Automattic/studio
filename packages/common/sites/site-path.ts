import { z } from 'zod';
import { readCliConfigFileRaw } from '../lib/cli-config-file';

/**
 * Resolves a site's directory straight from the CLI-owned `cli.json`.
 *
 * `listSites` answers the same question by forking the CLI, which costs about
 * a second of CPU per call — far too much for read-only lookups the UI makes on
 * every site switch. Use this when a route only needs the path; reach for
 * `listSites` when it needs live fields (`running`, `port`, `status`) or must
 * observe a write the CLI just made.
 */

const sitePathsSchema = z.object( {
	sites: z
		.array( z.object( { id: z.string(), path: z.string() } ).passthrough() )
		.optional()
		.default( [] ),
} );

export async function readSitePath( siteId: string ): Promise< string | null > {
	let config;
	try {
		config = sitePathsSchema.safeParse( await readCliConfigFileRaw() );
	} catch {
		return null;
	}
	if ( ! config.success ) {
		return null;
	}
	return config.data.sites.find( ( site ) => site.id === siteId )?.path ?? null;
}
