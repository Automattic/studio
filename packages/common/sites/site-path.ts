import { z } from 'zod';
import { readCliConfigFileRaw } from '../lib/cli-config-file';

// Resolves site directories straight from `cli.json` — use instead of
// `listSites` when a route only needs paths, to avoid a CLI fork.

const sitePathsSchema = z.object( {
	sites: z
		.array( z.object( { id: z.string(), path: z.string() } ).passthrough() )
		.optional()
		.default( [] ),
} );

async function readSites(): Promise< Array< { id: string; path: string } > > {
	try {
		const config = sitePathsSchema.safeParse( await readCliConfigFileRaw() );
		return config.success ? config.data.sites : [];
	} catch {
		return [];
	}
}

export async function readSitePath( siteId: string ): Promise< string | null > {
	return ( await readSites() ).find( ( site ) => site.id === siteId )?.path ?? null;
}

export async function readSitePaths(): Promise< string[] > {
	return ( await readSites() ).map( ( site ) => site.path );
}
