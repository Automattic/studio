import { useState } from 'react';
import { useLastSeenVersion } from 'src/hooks/use-last-seen-version';
import { useOnboarding } from 'src/hooks/use-onboarding';

interface UseWhatsNew {
	showWhatsNew: boolean;
	closeWhatsNewModal: () => void;
}

export function useWhatsNew(): UseWhatsNew {
	const [ showWhatsNew, setShowWhatsNew ] = useState( true );
	const { needsOnboarding } = useOnboarding();
	const { isNewVersion, updateLastSeenVersion } = useLastSeenVersion();

	const closeWhatsNewModal = async () => {
		setShowWhatsNew( false );
		await updateLastSeenVersion();
	};

	return {
		showWhatsNew: showWhatsNew && isNewVersion && ! needsOnboarding,
		closeWhatsNewModal,
	};
}
