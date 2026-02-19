import { useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOnboarding } from 'src/modules/onboarding/hooks/use-onboarding';
import { useLastSeenVersion } from 'src/modules/whats-new/hooks/use-last-seen-version';

interface UseWhatsNew {
	showWhatsNew: boolean;
	closeWhatsNew: () => void;
}

export function useWhatsNew(): UseWhatsNew {
	const [ manuallyTriggered, setManuallyTriggered ] = useState( false );
	const { needsOnboarding } = useOnboarding();
	const { isNewVersion, updateLastSeenVersion } = useLastSeenVersion();

	useIpcListener( 'show-whats-new', () => {
		setManuallyTriggered( true );
	} );

	const closeWhatsNew = async () => {
		setManuallyTriggered( false );
		await updateLastSeenVersion();
	};

	return {
		showWhatsNew: ( manuallyTriggered || isNewVersion ) && ! needsOnboarding,
		closeWhatsNew,
	};
}
