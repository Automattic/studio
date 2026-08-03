import { useEffect, useRef } from 'react';
import { useOnboardingGuide } from '@/components/onboarding-guide/use-onboarding-guide';
import { useConnector } from '@/data/core';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { useSaveLastSeenVersion } from '@/data/queries/use-whats-new-seen';
import { getWhatsNewGuide } from './whats-new';

/**
 * Reopens the What's New guide when the user picks Help ▸ What's New in the
 * application menu. Replaying also records the current version, so a user who
 * dug it out of the menu before it auto-opened isn't interrupted later. No-ops
 * on surfaces without an OS menu — the connector subscription never fires.
 */
export function useWhatsNewReplay(): void {
	const connector = useConnector();
	const { data: appGlobals } = useAppGlobals();
	const saveLastSeenVersion = useSaveLastSeenVersion();
	const { openGuide } = useOnboardingGuide();

	// The menu event fires outside React's data flow, so read the current version
	// through a ref instead of resubscribing when app globals resolve.
	const versionRef = useRef( appGlobals?.appVersion );
	useEffect( () => {
		versionRef.current = appGlobals?.appVersion;
	}, [ appGlobals?.appVersion ] );

	useEffect( () => {
		return connector.onShowWhatsNew( () => {
			openGuide( getWhatsNewGuide(), {
				onEnd: () => saveLastSeenVersion.mutate( versionRef.current ?? 'browser' ),
			} );
		} );
	}, [ connector, openGuide, saveLastSeenVersion ] );
}
