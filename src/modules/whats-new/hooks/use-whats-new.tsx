import { useState } from 'react';
import { FORCE_WHATS_NEW } from 'src/constants';
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
	const { needsOnboarding } = useOnboarding();
	const { isNewVersion, updateLastSeenVersion, currentVersion, lastSeenVersion } =
		useLastSeenVersion();

	const forceWhatsNew = !! (
		FORCE_WHATS_NEW &&
		currentVersion &&
		lastSeenVersion !== currentVersion
	);

	useIpcListener( 'show-whats-new', () => {
		setManuallyTriggered( true );
		setShowWhatsNew( true );
	} );

	const closeWhatsNew = async () => {
		setShowWhatsNew( false );
		setManuallyTriggered( false );
		await updateLastSeenVersion();
	};

	return {
		showWhatsNew:
			( manuallyTriggered || ( showWhatsNew && isNewVersion ) || forceWhatsNew ) &&
			! needsOnboarding,
		closeWhatsNew,
	};
}
