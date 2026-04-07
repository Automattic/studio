import { StatsGroup } from 'src/lib/bump-stats';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';

export const renameLaunchUniquesStat: Migration = {
	async needsToRun() {
		const userData = await loadUserData();
		return userData.lastBumpStats?.[ 'local-environment-launch-uniques' ] !== undefined;
	},
	async run() {
		const userData = await loadUserData();
		const lastBumpStat = userData.lastBumpStats![ 'local-environment-launch-uniques' ];

		userData.lastBumpStats![ StatsGroup.STUDIO_APP_LAUNCH_UNIQUE ] = lastBumpStat;
		delete userData.lastBumpStats![ 'local-environment-launch-uniques' ];

		try {
			await lockAppdata();
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	},
};
