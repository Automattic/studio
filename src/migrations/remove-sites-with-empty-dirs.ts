import { isEmptyDir } from 'src/lib/fs-utils';
import { saveUserData, loadUserData } from 'src/storage/user-data';

export async function removeSitesWithEmptyDirectories() {
	const userData = await loadUserData( true );
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
	await saveUserData( { ...userData, sites: sitesWithNonEmptyDirectories }, true );
}
