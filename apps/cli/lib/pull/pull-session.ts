import os from 'os';
import path from 'path';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	type SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { getSiteUrl } from 'cli/lib/cli-config/sites';

/** Holds each pulled site's Reprint state and runtime files. `studio delete` removes them. */
const PULLS_ROOT = path.join( os.homedir(), '.studio', 'pulls' );

/** Where a site's pull keeps its files. */
export interface PullSession {
	sitePath: string;
	localUrl: string;
	technicalSiteDirectory: string;
	rawDirectory: string;
	stateDirectory: string;
	runtimeDirectory: string;
	runtimeBlueprintPath: string;
}

// Keyed by site rather than remote, so the files follow the local site.
function getPullTechnicalDirectory( siteId: string ): string {
	return path.join( PULLS_ROOT, siteId );
}

export function getPullSession( site: SiteData ): PullSession {
	const technicalSiteDirectory = getPullTechnicalDirectory( site.id );
	return {
		sitePath: site.path,
		localUrl: getSiteUrl( site ),
		technicalSiteDirectory,
		rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
		stateDirectory: path.join( technicalSiteDirectory, 'state' ),
		runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
		runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
	};
}

/** Updates a site's record in `cli.json` under the config lock, if the site still exists. */
export async function updateSiteRecord(
	siteId: string,
	apply: ( record: SiteData ) => void
): Promise< void > {
	try {
		await lockCliConfig();
		const cliConfig = await readCliConfig();
		const record = cliConfig.sites.find( ( s ) => s.id === siteId );
		if ( record ) {
			apply( record );
			await saveCliConfig( cliConfig );
		}
	} finally {
		await unlockCliConfig();
	}
}
