/**
 * The classic UI is no longer available: users who were still on it land in the agentic UI, which
 * greets them as migrating users, the same as opting in from classic Studio used to.
 */

import { recordAgenticUiMigration } from 'src/modules/user-settings/lib/ipc-handlers';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';

export const moveClassicUsersToAgenticUi: Migration = {
	async needsToRun() {
		const { betaFeatures } = await loadUserData();
		return betaFeatures?.enableAgenticUi === false;
	},
	async run() {
		await recordAgenticUiMigration();
		try {
			await lockAppdata();
			const userData = await loadUserData();
			delete userData.betaFeatures?.enableAgenticUi;
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	},
};
