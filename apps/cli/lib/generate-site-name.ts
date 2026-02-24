import os from 'os';
import path from 'path';
import { isEmptyDir, pathExists } from '@studio/common/lib/fs-utils';
import { generateSiteName as generateSiteNameShared } from '@studio/common/lib/generate-site-name';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { readAppdata } from 'cli/lib/appdata';

const DEFAULT_SITES_DIR = path.join( os.homedir(), 'Studio' );

export function getDefaultSitePath( siteName: string ): string {
	const folderName = sanitizeFolderName( siteName );
	return path.join( DEFAULT_SITES_DIR, folderName );
}

/**
 * Generates a unique site name by checking existing sites and file paths.
 */
export async function generateSiteName(): Promise< string > {
	const appdata = await readAppdata();
	const usedNames = new Set( appdata.sites.map( ( site ) => site.name ) );

	return generateSiteNameShared( async ( name: string ) => {
		if ( usedNames.has( name ) ) {
			return false;
		}
		const proposedPath = getDefaultSitePath( name );
		try {
			if ( ! ( await pathExists( proposedPath ) ) ) {
				return true;
			}
			return await isEmptyDir( proposedPath );
		} catch {
			return true;
		}
	} );
}
