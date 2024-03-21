import React, {
	createContext,
	useContext,
	useState,
	useCallback,
	useEffect,
	useMemo,
	ReactNode,
} from 'react';
import { getIpcApi } from '../lib/get-ipc-api';
import { useSiteDetails } from './use-site-details';

export interface OnboardingContextType {
	completeOnboarding: () => void;
	showNextStep: boolean;
	needsOnboarding: boolean;
}

export const OnboardingContext = createContext< OnboardingContextType >( {
	completeOnboarding: () => undefined,
	showNextStep: false,
	needsOnboarding: false,
} );

interface OnboardingProviderProps {
	children: ReactNode;
}

export const OnboardingProvider: React.FC< OnboardingProviderProps > = ( { children } ) => {
	const [ onboardingInProgress, setOnboardingInProgress ] = useState< boolean >( false );
	const [ onboardingCompleted, setOnboardingCompleted ] = useState< boolean >( true );
	const { data, loadingSites } = useSiteDetails();

	useEffect( () => {
		getIpcApi()
			.getOnboardingData()
			.then( ( onboardingCompleted ) => {
				setOnboardingCompleted( onboardingCompleted );
			} );
	}, [] );

	const completeOnboarding = useCallback( async () => {
		setOnboardingInProgress( false );
		setOnboardingCompleted( true );
		await getIpcApi().saveOnboarding( true );
	}, [] );

	useEffect( () => {
		if ( loadingSites ) {
			return;
		}
		if ( data.length === 0 ) {
			setOnboardingInProgress( true );
			return;
		}
		if ( data.length > 0 && onboardingInProgress && onboardingCompleted ) {
			completeOnboarding();
		}
	}, [ completeOnboarding, data.length, loadingSites, onboardingCompleted, onboardingInProgress ] );

	const contextValue = useMemo(
		() => ( {
			completeOnboarding,
			showNextStep: onboardingCompleted === false && data.length > 0 && ! loadingSites,
			needsOnboarding: onboardingInProgress,
		} ),
		[ completeOnboarding, data.length, loadingSites, onboardingCompleted, onboardingInProgress ]
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
