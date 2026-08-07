import { useEffect, useRef } from 'react';
import { useOnboardingGuide } from '@/components/onboarding-guide/use-onboarding-guide';
import { useConnector } from '@/data/core';
import { useSaveLastSeenVersion, useWhatsNewVersion } from '@/data/queries/use-whats-new-seen';
import { getWhatsNewGuide } from './whats-new';

/**
 * Reopens the What's New guide when the user picks Help ▸ What's New in the
 * application menu. Replaying also records the current version, so a user who
 * dug it out of the menu before it auto-opened isn't interrupted later. No-ops
 * on surfaces without an OS menu — the connector subscription never fires.
 */
export function useWhatsNewReplay(): void {
	const connector = useConnector();
	const currentVersion = useWhatsNewVersion();
	const saveLastSeenVersion = useSaveLastSeenVersion();
	const { openGuide } = useOnboardingGuide();

	// The menu event fires outside React's data flow, so read the current version
	// through a ref instead of resubscribing when app globals resolve.
	const versionRef = useRef( currentVersion );
	useEffect( () => {
		versionRef.current = currentVersion;
	}, [ currentVersion ] );

	useEffect( () => {
		return connector.onShowWhatsNew( () => {
			openGuide( getWhatsNewGuide(), {
				onEnd: () => saveLastSeenVersion.mutate( versionRef.current ),
			} );
		} );
	}, [ connector, openGuide, saveLastSeenVersion ] );
}
