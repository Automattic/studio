import { useEffect, useRef } from 'react';
import { useConnector } from '@/data/core';
import { useOnboardingHints, useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { getOrientationGuide, ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import { useOnboardingGuide } from './use-onboarding-guide';

/**
 * Reopens the orientation guide when the user picks Help ▸ Getting Started in
 * the application menu. Finishing or skipping the replay records the seen
 * version just like the first-run autostart, so the guide never re-appears on
 * its own afterward. No-ops on surfaces without an OS menu — the connector
 * subscription simply never fires.
 */
export function useOrientationReplay(): void {
	const connector = useConnector();
	const { data: hints } = useOnboardingHints();
	const setHints = useSetOnboardingHints();
	const { openGuide } = useOnboardingGuide();

	// The menu event fires outside React's data flow, so read the latest variant
	// inputs through a ref instead of resubscribing every time they change.
	const variantRef = useRef( { migrating: false } );
	useEffect( () => {
		variantRef.current = { migrating: hints?.migratedFromClassic ?? false };
	}, [ hints?.migratedFromClassic ] );

	useEffect( () => {
		return connector.onShowGettingStarted( () => {
			openGuide( getOrientationGuide( variantRef.current ), {
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
