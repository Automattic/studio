import { z } from 'zod';
import { readCliConfigFileRaw } from '../lib/cli-config-file';

// Resolves a site's directory straight from `cli.json` — use instead of
// `listSites` when a route only needs the path, to avoid a CLI fork.

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
