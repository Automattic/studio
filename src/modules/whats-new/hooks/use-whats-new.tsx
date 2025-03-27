import { useState } from 'react';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOnboarding } from 'src/hooks/use-onboarding';
import { useLastSeenVersion } from 'src/modules/whats-new/hooks/use-last-seen-version';

interface UseWhatsNew {
	showWhatsNew: boolean;
	closeWhatsNew: () => void;
}

export function useWhatsNew(): UseWhatsNew {
	const [ showWhatsNew, setShowWhatsNew ] = useState( true );
	const [ manuallyTriggered, setManuallyTriggered ] = useState( false );
	const [ featureFlagModalSeen, setFeatureFlagModalSeen ] = useState( false );

	const { needsOnboarding } = useOnboarding();
	const { isNewVersion, updateLastSeenVersion } = useLastSeenVersion();
	const { whatsNewSectionEnabled } = useFeatureFlags();

	useIpcListener( 'show-whats-new', () => {
		setManuallyTriggered( true );
		setShowWhatsNew( true );
	} );

	const closeWhatsNew = async () => {
		setShowWhatsNew( false );
		setManuallyTriggered( false );

		// If the modal was shown because of the feature flag, mark it as seen
		if ( whatsNewSectionEnabled && ! manuallyTriggered && ! isNewVersion ) {
			setFeatureFlagModalSeen( true );
		}

		await updateLastSeenVersion();
	};

	// Determine if we should show the modal based on the feature flag
	const shouldForceWhatsNew = whatsNewSectionEnabled && ! featureFlagModalSeen;

	return {
		showWhatsNew:
			( manuallyTriggered || shouldForceWhatsNew || ( showWhatsNew && isNewVersion ) ) &&
			! needsOnboarding,
		closeWhatsNew,
	};
}
