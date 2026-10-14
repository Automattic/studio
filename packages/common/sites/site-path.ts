import { z } from 'zod';
import { readCliConfigFileRaw } from '../lib/cli-config-file';

// Resolves sites straight from `cli.json` — use instead of `listSites` when a
// caller only needs a site's id, name or path, to avoid a CLI fork.

const sitePathsSchema = z.object( {
	sites: z
		.array(
			z.object( { id: z.string(), name: z.string().catch( '' ), path: z.string() } ).passthrough()
		)
		.optional()
		.default( [] ),
} );

export async function readSites(): Promise< Array< { id: string; name: string; path: string } > > {
	try {
		const config = sitePathsSchema.safeParse( await readCliConfigFileRaw() );
		return config.success ? config.data.sites : [];
	} catch {
		return [];
	}
}

export async function readSite(
	siteId: string
): Promise< { id: string; name: string; path: string } | null > {
	return ( await readSites() ).find( ( site ) => site.id === siteId ) ?? null;
}

export async function readSitePath( siteId: string ): Promise< string | null > {
	return ( await readSite( siteId ) )?.path ?? null;
}

export async function readSitePaths(): Promise< string[] > {
	return ( await readSites() ).map( ( site ) => site.path );
}
