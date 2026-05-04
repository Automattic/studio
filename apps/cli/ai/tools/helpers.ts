import path from 'path';
import { readCliConfig, type SiteData } from 'cli/lib/cli-config/core';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';

/**
 * Local helpers for tools that live one-per-file under `apps/cli/ai/tools/`.
 *
 * Mirrors the small set of helpers that `apps/cli/ai/tools.ts` keeps private.
 * Kept narrow on purpose — only the helpers genuinely needed by this layout.
 */

export function textResult( text: string ) {
	return {
		content: [ { type: 'text' as const, text } ],
	};
}

export function errorResult( message: string ) {
	return {
		content: [ { type: 'text' as const, text: message } ],
		isError: true,
	};
}

async function findSiteByName( name: string ): Promise< SiteData | undefined > {
	const config = await readCliConfig();
	return config.sites.find( ( site ) => site.name.toLowerCase() === name.toLowerCase() );
}

export async function resolveSite( nameOrPath: string ): Promise< SiteData > {
	const byName = await findSiteByName( nameOrPath );
	if ( byName ) {
		return byName;
	}
	if ( ! path.isAbsolute( nameOrPath ) ) {
		const config = await readCliConfig();
		const byFolder = config.sites.find( ( site ) => path.basename( site.path ) === nameOrPath );
		if ( byFolder ) {
			return byFolder;
		}
	}
	return getSiteByFolder( nameOrPath );
}
