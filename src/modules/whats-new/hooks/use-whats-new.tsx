import { useState } from 'react';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { useOnboarding } from 'src/hooks/use-onboarding';
import { shouldForceWhatsNew } from 'src/modules/whats-new/config/whats-new-config';
import { useLastSeenVersion } from 'src/modules/whats-new/hooks/use-last-seen-version';

interface UseWhatsNew {
	showWhatsNew: boolean;
	closeWhatsNew: () => void;
}

export function useWhatsNew(): UseWhatsNew {
	const [ showWhatsNew, setShowWhatsNew ] = useState( true );
	const [ manuallyTriggered, setManuallyTriggered ] = useState( false );
	const [ forcedModalSeen, setForcedModalSeen ] = useState( false );
	const { needsOnboarding } = useOnboarding();
	const { isNewVersion, updateLastSeenVersion, currentVersion, lastSeenVersion } =
		useLastSeenVersion();

	const shouldForceForVersion = currentVersion
		? shouldForceWhatsNew( currentVersion ) && lastSeenVersion !== currentVersion
		: false;
	const forceWhatsNew = shouldForceForVersion && ! forcedModalSeen;

	useIpcListener( 'show-whats-new', () => {
		setManuallyTriggered( true );
		setShowWhatsNew( true );
		setForcedModalSeen( false );
	} );

	const closeWhatsNew = async () => {
		setShowWhatsNew( false );
		setManuallyTriggered( false );
		setForcedModalSeen( true );
		await updateLastSeenVersion();
	};

	return {
		showWhatsNew:
			( manuallyTriggered || ( showWhatsNew && isNewVersion ) || forceWhatsNew ) &&
			! needsOnboarding,
		closeWhatsNew,
	};
}
