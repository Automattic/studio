import { readConfig, updateConfig } from '@studio/common/lib/config/store';
import { onboardingHintsSchema } from './user-preferences';

/** Capture first-use eligibility before launch stats or welcome completion are written. */
export async function initializeWalkthrough(): Promise< void > {
	await updateConfig( ( { preferences, stats, sites, snapshots } ) => {
		const hints = onboardingHintsSchema.catch( {} ).parse( preferences.onboardingHints );
		if ( hints.walkthroughStep !== undefined ) return;
		const usedBefore =
			preferences.onboardingCompleted === true ||
			Object.keys( stats.lastBump ).length > 0 ||
			hints.migratedFromClassic === true ||
			hints.tourCompletedVersion !== undefined ||
			hints.tourDismissedVersion !== undefined ||
			hints.whatsNewSeenVersion !== undefined ||
			sites.length > 0 ||
			snapshots.length > 0;
		preferences.onboardingHints = {
			...hints,
			walkthroughStep: usedBefore ? 'ineligible' : 'create',
		};
	} );
}

export async function readOnboardingCompleted(): Promise< boolean > {
	return ( await readConfig() ).preferences.onboardingCompleted === true;
}

/** Returns whether this write completed onboarding for the first time. */
export async function writeOnboardingCompleted( completed: boolean ): Promise< boolean > {
	return updateConfig( ( { preferences } ) => {
		const wasCompleted = preferences.onboardingCompleted === true;
		preferences.onboardingCompleted = completed;
		return completed && ! wasCompleted;
	} );
}
