import { StatsGroup } from 'common/types/stats';
import { loadUserData, saveUserData } from 'src/storage/user-data';

export async function renameLaunchUniquesStat() {
	const userData = await loadUserData();
	const lastBumpStat = userData.lastBumpStats?.[ 'local-environment-launch-uniques' ];

	if ( lastBumpStat === undefined ) {
		return;
	}

	userData.lastBumpStats![ StatsGroup.STUDIO_APP_LAUNCH_UNIQUE ] = lastBumpStat;
	delete userData.lastBumpStats![ 'local-environment-launch-uniques' ];

	await saveUserData( userData );
}
