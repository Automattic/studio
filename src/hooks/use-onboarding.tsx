import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { useSiteDetails } from './use-site-details';

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

	const needsOnboarding = useMemo(
		() => ! ( loadingSites || data.length > 0 ),
		[ data.length, loadingSites ]
	);

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
