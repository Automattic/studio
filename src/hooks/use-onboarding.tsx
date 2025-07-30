import React, { createContext, useContext, useMemo, ReactNode, useEffect } from 'react';
import { useSiteDetails } from 'src/hooks/use-site-details';
import { useRootSelector, useAppDispatch } from 'src/stores';
import {
	selectOnboardingCompleted,
	selectOnboardingLoading,
	loadOnboardingStatus,
} from 'src/stores/onboarding-slice';

export interface OnboardingContextType {
	needsOnboarding: boolean;
}

export const OnboardingContext = createContext< OnboardingContextType >( {
	needsOnboarding: false,
} );

interface OnboardingProviderProps {
	children: ReactNode;
}

export const OnboardingProvider: React.FC< OnboardingProviderProps > = ( { children } ) => {
	const { data, loadingSites } = useSiteDetails();
	const onboardingCompleted = useRootSelector( selectOnboardingCompleted );
	const onboardingLoading = useRootSelector( selectOnboardingLoading );
	const dispatch = useAppDispatch();

	// Load onboarding completion status on mount
	useEffect( () => {
		void dispatch( loadOnboardingStatus() );
	}, [ dispatch ] );

	const needsOnboarding = useMemo( () => {
		// Don't show onboarding while loading
		if ( onboardingLoading ) {
			return false;
		}

		// Show onboarding only if the user hasn't completed it and has no sites
		return ! ( loadingSites || data.length > 0 || onboardingCompleted );
	}, [ loadingSites, onboardingCompleted, onboardingLoading, data ] );

	const contextValue = useMemo(
		() => ( {
			needsOnboarding,
		} ),
		[ needsOnboarding ]
	);

	return (
		<OnboardingContext.Provider value={ contextValue }>{ children }</OnboardingContext.Provider>
	);
};

export const useOnboarding = (): OnboardingContextType => {
	const context = useContext( OnboardingContext );

	if ( ! context ) {
		throw new Error( 'useOnboarding must be used within an OnboardingProvider' );
	}

	return context;
};
