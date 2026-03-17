import { generateSiteName as generateSiteNameShared } from '@studio/common/lib/generate-site-name';
import { readCliConfig } from 'cli/lib/cli-config';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';

export async function generateSiteName(): Promise< string > {
	const cliConfig = await readCliConfig();
	const usedNames = cliConfig.sites.map( ( site ) => site.name );
	return generateSiteNameShared( usedNames, STUDIO_SITES_ROOT );
}
