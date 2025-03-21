import { useState, useEffect } from 'react';
import { useOnboarding } from 'src/hooks/use-onboarding';

interface UseWhatsNewResult {
	/**
	 * Whether the "What's New" modal should be shown
	 */
	showWhatsNew: boolean;

	/**
	 * Function to close the "What's New" modal
	 */
	closeWhatsNewModal: () => void;
}

/**
 * Hook to manage the "What's New" modal visibility
 *
 * @returns Object with showWhatsNew state and closeWhatsNewModal function
 */
export function useWhatsNew(): UseWhatsNewResult {
	const [ showWhatsNew, setShowWhatsNew ] = useState( true );
	const { needsOnboarding } = useOnboarding();

	// Log the app version for debugging
	useEffect( () => {
		const { appVersion } = window.appGlobals;
		console.log( 'App version:', appVersion );
	}, [] );

	const closeWhatsNewModal = () => {
		setShowWhatsNew( false );
	};

	return {
		// Only show the modal if showWhatsNew is true and we're not in onboarding
		showWhatsNew: showWhatsNew && ! needsOnboarding,
		closeWhatsNewModal,
	};
}
