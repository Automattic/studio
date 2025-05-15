import { isEmptyDir } from 'src/lib/fs-utils';
import { withUserDataWrite } from 'src/storage/user-data';

export const removeSitesWithEmptyDirectories = withUserDataWrite( async ( userData ) => {
	const sitesWithNonEmptyDirectories: SiteDetails[] = [];
	const storedSites = userData.sites || [];
	for ( const site of storedSites ) {
		if ( ! site.path ) {
			continue;
		}
		const directoryIsEmpty = await isEmptyDir( site.path );
		if ( ! directoryIsEmpty ) {
			sitesWithNonEmptyDirectories.push( site );
		}
	}
	return { ...userData, sites: sitesWithNonEmptyDirectories };
} );
