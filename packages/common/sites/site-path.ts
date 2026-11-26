import { readConfig } from '../lib/config/store';

// Resolves sites straight from the config file: use instead of `listSites` when a
// caller only needs a site's id, name or path, to avoid a CLI fork.

export async function readSites(): Promise< Array< { id: string; name: string; path: string } > > {
	try {
		return ( await readConfig() ).sites.map( ( { id, name, path } ) => ( { id, name, path } ) );
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
