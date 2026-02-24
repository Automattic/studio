import {
	generateNumberedName as generateNumberedNameShared,
	generateSiteName as generateSiteNameShared,
} from '@studio/common/lib/generate-site-name';
import { getIpcApi } from 'src/lib/get-ipc-api';

export { sanitizeFolderName } from '@studio/common/lib/sanitize-folder-name';

function createIsNameAvailable( usedSites: SiteDetails[] ): ( name: string ) => Promise< boolean > {
	return async ( name: string ) => {
		const isNameUnique = ! usedSites.some( ( site ) => site.name === name );
		if ( ! isNameUnique ) {
			return false;
		}
		const { isEmpty } = await getIpcApi().generateProposedSitePath( name );
		return isEmpty;
	};
}

/**
 * Generates a unique numbered name by iterating until an available name is found.
 * Example: "My WordPress site 2" if "My WordPress site" exists
 */
export async function generateNumberedName(
	baseName: string,
	usedSites: SiteDetails[]
): Promise< string > {
	return generateNumberedNameShared( baseName, createIsNameAvailable( usedSites ) );
}

/**
 * Generates a random site name from a list of default names.
 * Example: "My WordPress Website"
 */
export async function generateSiteName( usedSites: SiteDetails[] ): Promise< string > {
	return generateSiteNameShared( createIsNameAvailable( usedSites ) );
}
