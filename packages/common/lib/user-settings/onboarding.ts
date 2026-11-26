import { readConfig, updateConfig } from '@studio/common/lib/config/store';

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
