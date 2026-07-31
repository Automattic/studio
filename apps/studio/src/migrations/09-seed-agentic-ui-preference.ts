/**
 * Seeds an explicit `betaFeatures.enableAgenticUi` so the agentic UI becomes the default for
 * fresh installs only — existing users stay on the classic UI until they opt in (STU-2149).
 *
 * `lastBumpStats` is the marker for "this install has launched before": migrations run before
 * the launch stats are bumped, so an absent value here really does mean first launch. It's the
 * same signal Tracks uses for `is_first_launch` (see `index.ts`).
 *
 * Deliberately leaves `BETA_FEATURE_DEFAULTS.enableAgenticUi` as `false`, so if this migration
 * ever fails the fallback keeps existing users where they are rather than moving them. Delete
 * this file once the agentic UI becomes the plain default for everyone.
 */

import { updateBetaFeature } from 'src/lib/beta-features';
import { loadUserData } from 'src/storage/user-data';
import type { Migration } from '@studio/common/lib/migration';

export const seedAgenticUiPreference: Migration = {
	async needsToRun() {
		const { betaFeatures } = await loadUserData();
		return betaFeatures?.enableAgenticUi === undefined;
	},
	async run() {
		const { lastBumpStats } = await loadUserData();
		await updateBetaFeature( 'enableAgenticUi', ! lastBumpStats );
	},
};
