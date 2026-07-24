import { useEffect, useRef } from 'react';
import { useOnboardingGuide } from '@/components/onboarding-guide/use-onboarding-guide';
import { useConnector } from '@/data/core';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import {
	useOnboardingCompleted,
	useOnboardingHints,
	useSetOnboardingHints,
} from '@/data/queries/use-onboarding-hints';
import { useSites } from '@/data/queries/use-sites';
import { ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import type { OrientationVariant } from './orientation-guide';
import type { OnboardingHintsState } from '@/data/core';

interface AutostartInputs {
	onboardingCompleted: boolean | undefined;
	siteCount: number;
	agentic: { enabled: boolean; isReady: boolean };
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
	// Returning users skip the pre-workbench welcome (sites already existed), so
	// their returning flag stands in for onboardingCompleted here.
	const welcomeDone = onboardingCompleted === true || hints?.returningUser === true;
	if ( ! welcomeDone || siteCount < 1 || ! agentic.isReady ) {
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
	return agentic.enabled ? 'agentic' : 'overview';
}

/**
 * Pure decision: is this the user's first-ever arrival in the workbench?
 * True only when no orientation guide of any version has been completed or
 * dismissed. Guards the one-time window expansion so a guide re-armed by a
 * version bump doesn't resize an existing user's window.
 */
export function isFirstWorkbenchArrival( hints: OnboardingHintsState | undefined ): boolean {
	return ( hints?.tourCompletedVersion ?? 0 ) === 0 && ( hints?.tourDismissedVersion ?? 0 ) === 0;
}

// Let the workbench render and settle before the guide appears, so it reads as
// an entrance rather than part of the initial paint.
const GUIDE_START_DELAY_MS = 500;

/**
 * Auto-opens the orientation guide once on first arrival in the workbench.
 * On the first-ever arrival it also grows the window to a comfortable
 * workbench size before the guide appears. Mounted in the dashboard layout.
 */
export function useOrientationAutostart(): void {
	const connector = useConnector();
	const { data: sites } = useSites();
	const agentic = useAgenticFeatures();
	const { data: hints } = useOnboardingHints();
	const setHints = useSetOnboardingHints();
	const { isOpen, openGuide } = useOnboardingGuide();

	const { data: onboardingCompleted } = useOnboardingCompleted();

	const startedRef = useRef( false );
	const startTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );
	const mountedRef = useRef( true );

	useEffect( () => {
		const variant = deriveOrientationAutostart( {
			onboardingCompleted,
			siteCount: sites?.length ?? 0,
			agentic: { enabled: agentic.chatEnabled, isReady: agentic.isReady },
			hints,
			guideOpen: isOpen,
			alreadyStarted: startedRef.current,
		} );
		if ( ! variant ) {
			return;
		}
		// Mark started immediately so a dependency change can't schedule twice.
		startedRef.current = true;
		const openGuideAfterDelay = () => {
			// The expansion can settle after the layout unmounted; don't open then.
			if ( ! mountedRef.current ) {
				return;
			}
			startTimerRef.current = setTimeout( () => {
				startTimerRef.current = null;
				openGuide( variant, {
					onEnd: ( reason ) => {
						if ( reason === 'completed' ) {
							setHints.mutate( { tourCompletedVersion: ORIENTATION_GUIDE_VERSION } );
						} else {
							setHints.mutate( { tourDismissedVersion: ORIENTATION_GUIDE_VERSION } );
						}
					},
				} );
			}, GUIDE_START_DELAY_MS );
		};
		if ( isFirstWorkbenchArrival( hints ) ) {
			// First-ever arrival: grow the window to a comfortable workbench size,
			// then bring the guide in once the animation settles.
			void connector
				.expandWindowForWorkbench()
				.catch( () => undefined )
				.then( openGuideAfterDelay );
		} else {
			openGuideAfterDelay();
		}
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
		connector,
	] );

	useEffect( () => {
		// Reset on mount: StrictMode re-runs effects on the same refs, so the
		// dev-only unmount pass would otherwise leave this false forever.
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			if ( startTimerRef.current ) {
				clearTimeout( startTimerRef.current );
				startTimerRef.current = null;
			}
		};
	}, [] );
}
