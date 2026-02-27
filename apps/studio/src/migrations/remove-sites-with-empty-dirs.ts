import { isEmptyDir } from '@studio/common/lib/fs-utils';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

export async function removeSitesWithEmptyDirectories() {
	try {
		await lockAppdata();
		const userData = await loadUserData();
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
		await saveUserData( { ...userData, sites: sitesWithNonEmptyDirectories } );
	} finally {
		await unlockAppdata();
	}
}
