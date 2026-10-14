/**
 * The classic UI is no longer available: users who were still on it land in the agentic UI, which
 * greets them as migrating users, the same as opting in from classic Studio used to.
 */

import { updateBetaFeature } from 'src/lib/beta-features';
import { recordAgenticUiMigration } from 'src/modules/user-settings/lib/ipc-handlers';
import { loadUserData } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';

export const moveClassicUsersToAgenticUi: Migration = {
	async needsToRun() {
		const { betaFeatures } = await loadUserData();
		return betaFeatures?.enableAgenticUi === false;
	},
	async run() {
		await recordAgenticUiMigration();
		await updateBetaFeature( 'enableAgenticUi', true );
	},
};
