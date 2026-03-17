import { generateSiteName as generateSiteNameShared } from '@studio/common/lib/generate-site-name';
import { readAppdata } from 'cli/lib/appdata';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';

export async function generateSiteName(): Promise< string > {
	const appdata = await readAppdata();
	const usedNames = appdata.sites.map( ( site ) => site.name );
	return generateSiteNameShared( usedNames, STUDIO_SITES_ROOT );
}
