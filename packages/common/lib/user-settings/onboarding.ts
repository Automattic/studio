import { readAppConfig, updateAppConfig } from '@studio/common/lib/app-config';

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
