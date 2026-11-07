import { readAppConfig, updateAppConfig } from '@studio/common/lib/app-config';
import { readCliConfigFileRaw } from '@studio/common/lib/cli-config-file';
import { onboardingHintsSchema } from './user-preferences';

/** Capture first-use eligibility before launch stats or welcome completion are written. */
export async function initializeWalkthrough(): Promise< void > {
	const cliConfig = await readCliConfigFileRaw();
	await updateAppConfig( ( config ) => {
		const hints = onboardingHintsSchema.catch( {} ).parse( config.onboardingHints );
		if ( hints.walkthroughStep !== undefined ) return;
		const usedBefore =
			config.onboardingCompleted === true ||
			config.lastBumpStats !== undefined ||
			hints.migratedFromClassic === true ||
			hints.tourCompletedVersion !== undefined ||
			hints.tourDismissedVersion !== undefined ||
			hints.whatsNewSeenVersion !== undefined ||
			( Array.isArray( cliConfig.sites ) && cliConfig.sites.length > 0 ) ||
			( Array.isArray( cliConfig.snapshots ) && cliConfig.snapshots.length > 0 );
		config.onboardingHints = { ...hints, walkthroughStep: usedBefore ? 'ineligible' : 'create' };
	} );
}

export async function readOnboardingCompleted(): Promise< boolean > {
	return ( await readAppConfig() ).onboardingCompleted === true;
}

/** Returns whether this write completed onboarding for the first time. */
export async function writeOnboardingCompleted( completed: boolean ): Promise< boolean > {
	return updateAppConfig( ( config ) => {
		const wasCompleted = config.onboardingCompleted === true;
		config.onboardingCompleted = completed;
		return completed && ! wasCompleted;
	} );
}
