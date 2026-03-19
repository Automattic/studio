import { StatsGroup } from 'src/lib/bump-stats';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';

export async function renameLaunchUniquesStat() {
	const userData = await loadUserData();
	const lastBumpStat = userData.lastBumpStats?.[ 'local-environment-launch-uniques' ];

	if ( lastBumpStat === undefined ) {
		return;
	}

	userData.lastBumpStats![ StatsGroup.STUDIO_APP_LAUNCH_UNIQUE ] = lastBumpStat;
	delete userData.lastBumpStats![ 'local-environment-launch-uniques' ];

	try {
		await lockAppdata();
		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}
