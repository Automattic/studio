import { useCallback, useEffect } from 'react';
import { useConnector } from '@/data/core';
import { useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { useOnboardingGuide } from './use-onboarding-guide';
import { getWhatsNewGuide, WHATS_NEW_VERSION } from './whats-new';

/**
 * Opens the What's New guide. However it ends, the current pages count as seen.
 */
export function useOpenWhatsNew(): () => void {
	const { mutate: setHints } = useSetOnboardingHints();
	const { openGuide } = useOnboardingGuide();
	return useCallback( () => {
		openGuide( getWhatsNewGuide(), {
			onEnd: () => setHints( { whatsNewSeenVersion: WHATS_NEW_VERSION } ),
		} );
	}, [ openGuide, setHints ] );
}

/**
 * Reopens the What's New guide from Help ▸ What's New in the application menu.
 * No-ops on surfaces without an OS menu.
 */
export function useWhatsNewReplay(): void {
	const connector = useConnector();
	const openWhatsNew = useOpenWhatsNew();
	useEffect( () => connector.onShowWhatsNew( openWhatsNew ), [ connector, openWhatsNew ] );
}
