import { useState } from 'react';
import { useOnboarding } from 'src/hooks/use-onboarding';
import { useLastSeenVersion } from 'src/modules/whats-new/hooks/use-last-seen-version';

interface UseWhatsNew {
	showWhatsNew: boolean;
	closeWhatsNew: () => void;
}

export function useWhatsNew(): UseWhatsNew {
	const [ showWhatsNew, setShowWhatsNew ] = useState( true );
	const { needsOnboarding } = useOnboarding();
	const { isNewVersion, updateLastSeenVersion } = useLastSeenVersion();

	const closeWhatsNew = async () => {
		setShowWhatsNew( false );
		await updateLastSeenVersion();
	};

	return {
		showWhatsNew: showWhatsNew && isNewVersion && ! needsOnboarding,
		closeWhatsNew,
	};
}
