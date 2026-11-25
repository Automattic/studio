import { readConfig, updateConfig } from '@studio/common/lib/config/store';

export async function readOnboardingCompleted(): Promise< boolean > {
	return ( await readConfig() ).preferences.onboardingCompleted === true;
}

/**
 * Returns whether this write completed onboarding for the first time. Onboarding tells the person
 * how usage statistics are shared, so finishing it also counts as seeing the usage notice.
 */
export async function writeOnboardingCompleted( completed: boolean ): Promise< boolean > {
	return updateConfig( ( { preferences } ) => {
		const wasCompleted = preferences.onboardingCompleted === true;
		preferences.onboardingCompleted = completed;
		const firstCompletion = completed && ! wasCompleted;
		if ( firstCompletion ) {
			preferences.usageNoticeSeen = true;
		}
		return firstCompletion;
	} );
}

// People onboarded before usage statistics were linked to the account see the notice once.
export async function readUsageNoticePending(): Promise< boolean > {
	const { preferences } = await readConfig();
	return preferences.onboardingCompleted === true && preferences.usageNoticeSeen !== true;
}

export async function writeUsageNoticeSeen(): Promise< void > {
	await updateConfig( ( { preferences } ) => {
		preferences.usageNoticeSeen = true;
	} );
}
