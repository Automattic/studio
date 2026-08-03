import { useEffect, useRef } from 'react';
import { useOnboardingGuide } from '@/components/onboarding-guide/use-onboarding-guide';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import {
	useOnboardingCompleted,
	useOnboardingHints,
	useSetOnboardingHints,
} from '@/data/queries/use-onboarding-hints';
import { useSites } from '@/data/queries/use-sites';
import { getOrientationGuide, ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import type { OrientationVariant } from './orientation-guide';
import type { OnboardingHintsState } from '@/data/core';

interface AutostartInputs {
	onboardingCompleted: boolean | undefined;
	siteCount: number;
	agentic: { chatEnabled: boolean; isReady: boolean };
	hints: OnboardingHintsState | undefined;
	guideOpen: boolean;
	alreadyStarted: boolean;
}

/**
 * Pure decision: which orientation guide variant (if any) to auto-open.
 * Returns null unless the user finished the pre-workbench welcome, has at least
 * one site, the agentic gate has resolved, hints have loaded, nothing is
 * already showing, and this app session hasn't opened the guide yet.
 */
export function deriveOrientationAutostart( {
	onboardingCompleted,
	siteCount,
	agentic,
	hints,
	guideOpen,
	alreadyStarted,
}: AutostartInputs ): OrientationVariant | null {
	if ( alreadyStarted || guideOpen ) {
		return null;
	}
	if ( onboardingCompleted !== true || siteCount < 1 || ! agentic.isReady ) {
		return null;
	}
	if ( hints === undefined ) {
		return null;
	}
	const seen =
		( hints.tourCompletedVersion ?? 0 ) >= ORIENTATION_GUIDE_VERSION ||
		( hints.tourDismissedVersion ?? 0 ) >= ORIENTATION_GUIDE_VERSION;
	if ( seen ) {
		return null;
	}
	return { migrating: hints.migratedFromClassic ?? false, chatEnabled: agentic.chatEnabled };
}

// Let the workbench render and settle before the guide appears, so it reads as
// an entrance rather than part of the initial paint.
const GUIDE_START_DELAY_MS = 500;

/**
 * Auto-opens the orientation guide once on first arrival in the workbench.
 * Mounted in the dashboard layout.
 */
export function useOrientationAutostart(): void {
	const { data: sites } = useSites();
	const agentic = useAgenticFeatures();
	const { data: hints } = useOnboardingHints();
	const setHints = useSetOnboardingHints();
	const { isOpen, openGuide } = useOnboardingGuide();

	const { data: onboardingCompleted } = useOnboardingCompleted();

	const startedRef = useRef( false );
	const startTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );

	useEffect( () => {
		const variant = deriveOrientationAutostart( {
			onboardingCompleted,
			siteCount: sites?.length ?? 0,
			agentic: { chatEnabled: agentic.chatEnabled, isReady: agentic.isReady },
			hints,
			guideOpen: isOpen,
			alreadyStarted: startedRef.current,
		} );
		if ( ! variant ) {
			return;
		}
		// Mark started immediately so a dependency change can't schedule twice.
		startedRef.current = true;
		startTimerRef.current = setTimeout( () => {
			startTimerRef.current = null;
			openGuide( getOrientationGuide( variant ), {
				onEnd: ( reason ) => {
					if ( reason === 'completed' ) {
						setHints.mutate( { tourCompletedVersion: ORIENTATION_GUIDE_VERSION } );
					} else {
						setHints.mutate( { tourDismissedVersion: ORIENTATION_GUIDE_VERSION } );
					}
				},
			} );
		}, GUIDE_START_DELAY_MS );
		// No timer cleanup here: a dependency change re-runs this effect and
		// returns early (startedRef guard); clearing on every re-run would
		// cancel the pending open. The mount-scoped cleanup below handles it.
	}, [
		onboardingCompleted,
		sites?.length,
		agentic.chatEnabled,
		agentic.isReady,
		hints,
		isOpen,
		openGuide,
		setHints,
	] );

	useEffect( () => {
		return () => {
			if ( startTimerRef.current ) {
				clearTimeout( startTimerRef.current );
				startTimerRef.current = null;
			}
		};
	}, [] );
}
