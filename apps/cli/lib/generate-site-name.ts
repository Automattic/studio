import os from 'os';
import path from 'path';
import { generateSiteName as generateSiteNameShared } from '@studio/common/lib/generate-site-name';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { readCliConfig } from 'cli/lib/cli-config/core';

const DEFAULT_SITES_DIR = path.join( os.homedir(), 'Studio' );

export function getDefaultSitePath( siteName: string ): string {
	const folderName = sanitizeFolderName( siteName );
	return path.join( DEFAULT_SITES_DIR, folderName );
}

export async function generateSiteName(): Promise< string > {
	const cliConfig = await readCliConfig();
	const usedNames = cliConfig.sites.map( ( site ) => site.name );
	return generateSiteNameShared( usedNames, DEFAULT_SITES_DIR );
}
