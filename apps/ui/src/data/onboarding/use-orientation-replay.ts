import { useEffect, useRef } from 'react';
import { useOnboardingGuide } from '@/components/onboarding-guide/use-onboarding-guide';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { ORIENTATION_GUIDE_VERSION } from './orientation-guide';

/**
 * Reopens the orientation guide when the user picks Help ▸ Getting Started in
 * the application menu. Finishing or skipping the replay records the seen
 * version just like the first-run autostart, so the guide never re-appears on
 * its own afterward. No-ops on surfaces without an OS menu — the connector
 * subscription simply never fires.
 */
export function useOrientationReplay(): void {
	const connector = useConnector();
	const agentic = useAgenticFeatures();
	const setHints = useSetOnboardingHints();
	const { openGuide } = useOnboardingGuide();

	// The menu event fires outside React's data flow, so read the latest gate
	// through a ref instead of resubscribing every time it changes.
	const enabledRef = useRef( agentic.enabled );
	useEffect( () => {
		enabledRef.current = agentic.enabled;
	}, [ agentic.enabled ] );

	useEffect( () => {
		return connector.onShowGettingStarted( () => {
			openGuide( enabledRef.current ? 'agentic' : 'overview', {
				onEnd: ( reason ) => {
					setHints.mutate(
						reason === 'completed'
							? { tourCompletedVersion: ORIENTATION_GUIDE_VERSION }
							: { tourDismissedVersion: ORIENTATION_GUIDE_VERSION }
					);
				},
			} );
		} );
	}, [ connector, openGuide, setHints ] );
}
