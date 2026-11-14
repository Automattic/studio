import path from 'path';
import { isEmptyDir, pathExists } from '@studio/common/lib/fs-utils';
import { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';
import { numberedSiteName, pickSiteName } from '@studio/common/lib/site-names';

// A name is free when no site uses it and its folder is missing or empty.
const isNameAvailable =
	( usedNames: string[], sitesDir: string ) =>
	async ( name: string ): Promise< boolean > => {
		if ( usedNames.includes( name ) ) {
			return false;
		}
		const sitePath = path.join( sitesDir, sanitizeFolderName( name ) );
		try {
			if ( ! ( await pathExists( sitePath ) ) ) {
				return true;
			}
			return await isEmptyDir( sitePath );
		} catch {
			return true;
		}
	};

export function generateNumberedName(
	baseName: string,
	usedNames: string[],
	sitesDir: string
): Promise< string > {
	return numberedSiteName( baseName, isNameAvailable( usedNames, sitesDir ) );
}

export function generateSiteName( usedNames: string[], sitesDir: string ): Promise< string > {
	return pickSiteName( isNameAvailable( usedNames, sitesDir ) );
}
