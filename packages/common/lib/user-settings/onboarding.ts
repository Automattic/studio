import { readConfig, updateConfig } from '@studio/common/lib/config/store';
import { onboardingHintsSchema } from './user-preferences';

/** Capture first-use eligibility before launch stats or welcome completion are written. */
export async function initializeWalkthrough(): Promise< void > {
	await updateConfig( ( config ) => {
		const hints = onboardingHintsSchema.catch( {} ).parse( config.preferences.onboardingHints );
		if ( hints.walkthroughStep !== undefined ) return;
		const usedBefore =
			config.preferences.onboardingCompleted === true ||
			Object.keys( config.stats.lastBump ).length > 0 ||
			hints.migratedFromClassic === true ||
			hints.tourCompletedVersion !== undefined ||
			hints.tourDismissedVersion !== undefined ||
			hints.whatsNewSeenVersion !== undefined ||
			( Array.isArray( config.sites ) && config.sites.length > 0 ) ||
			( Array.isArray( config.snapshots ) && config.snapshots.length > 0 );
		config.preferences.onboardingHints = { ...hints, walkthroughStep: usedBefore ? 'ineligible' : 'create' };
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
