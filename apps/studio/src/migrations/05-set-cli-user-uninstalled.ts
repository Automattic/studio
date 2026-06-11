/**
 * Before `cliUserUninstalled` existed, an absent CLI symlink/directory combined
 * with `cliAutoInstalled: true` was the only signal that the user had uninstalled
 * the CLI via Settings. This migration converts that implicit state into the
 * explicit `cliUserUninstalled: true` flag so that `autoInstallIfNeeded` can
 * simply check `cliUserUninstalled` without having to reason about the old state.
 */

import { isStudioCliInstalled } from 'src/modules/cli/lib/ipc-handlers';
import { loadUserData, lockAppdata, saveUserData, unlockAppdata } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';

export const setCliUserUninstalled: Migration = {
	async needsToRun() {
		const userData = await loadUserData();
		return userData.cliAutoInstalled !== undefined && userData.cliUserUninstalled === undefined;
	},
	async run() {
		try {
			await lockAppdata();
			const userData = await loadUserData();
			userData.cliUserUninstalled = ! ( await isStudioCliInstalled() );
			delete userData.cliAutoInstalled;
			await saveUserData( userData );
		} finally {
			await unlockAppdata();
		}
	},
};
