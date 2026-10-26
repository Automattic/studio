import { useEffect, useRef } from 'react';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { useOnboardingHints, useSetOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { useSites } from '@/data/queries/use-sites';
import { ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import { useOnboardingGuide } from './use-onboarding-guide';
import { useRootDialogOpen } from './use-root-dialog-open';
import { useOpenWhatsNew } from './use-whats-new-replay';
import { WHATS_NEW_VERSION } from './whats-new';
import type { OnboardingHintsState } from '@/data/core';

interface AutostartInputs {
	siteCount: number;
	agenticReady: boolean;
	hints: OnboardingHintsState | undefined;
	dialogOpen: boolean;
	guideOpen: boolean;
	alreadyStarted: boolean;
}

type WhatsNewAutostart = 'show' | 'mark-seen' | null;

/**
 * Pure decision: whether to auto-open the What's New guide. Returns null until
 * the user has a site, the workspace state has loaded and nothing else is open,
 * and once the current pages have been seen.
 */
export function deriveWhatsNewAutostart( {
	siteCount,
	agenticReady,
	hints,
	dialogOpen,
	guideOpen,
	alreadyStarted,
}: AutostartInputs ): WhatsNewAutostart {
	if ( alreadyStarted || guideOpen || dialogOpen ) {
		return null;
	}
	if ( siteCount < 1 || ! agenticReady || hints === undefined ) {
		return null;
	}
	if ( ( hints.whatsNewSeenVersion ?? 0 ) >= WHATS_NEW_VERSION ) {
		return null;
	}
	// Someone who hasn't been through the orientation guide gets that instead,
	// and nothing in What's New is news to them: mark it seen so the two never
	// stack. Orientation autostarts on exactly the state that returns 'mark-seen'.
	const orientationSeen =
		( hints.tourCompletedVersion ?? 0 ) >= ORIENTATION_GUIDE_VERSION ||
		( hints.tourDismissedVersion ?? 0 ) >= ORIENTATION_GUIDE_VERSION;
	return orientationSeen ? 'show' : 'mark-seen';
}

// Matches the orientation guide's entrance delay, so the modal reads as arriving
// rather than as part of the initial paint.
const GUIDE_START_DELAY_MS = 500;

/**
 * Auto-opens the What's New guide once per WHATS_NEW_VERSION. Mounted in the
 * dashboard layout.
 */
export function useWhatsNewAutostart(): void {
	const { data: sites } = useSites();
	const { isReady: agenticReady } = useAgenticFeatures();
	const { data: hints } = useOnboardingHints();
	const { mutate: setHints } = useSetOnboardingHints();
	const dialogOpen = useRootDialogOpen();
	const { isOpen } = useOnboardingGuide();
	const openWhatsNew = useOpenWhatsNew();

	const startedRef = useRef( false );
	const startTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );

	useEffect( () => {
		const decision = deriveWhatsNewAutostart( {
			siteCount: sites?.length ?? 0,
			agenticReady,
			hints,
			dialogOpen,
			guideOpen: isOpen,
			alreadyStarted: startedRef.current,
		} );
		if ( ! decision ) {
			return;
		}
		startedRef.current = true;
		if ( decision === 'mark-seen' ) {
			setHints( { whatsNewSeenVersion: WHATS_NEW_VERSION } );
			return;
		}
		startTimerRef.current = setTimeout( () => {
			startTimerRef.current = null;
			openWhatsNew();
		}, GUIDE_START_DELAY_MS );
		// No timer cleanup here: a dependency change re-runs this effect and
		// returns early (startedRef guard); clearing on every re-run would
		// cancel the pending open. The mount-scoped cleanup below handles it.
	}, [ sites?.length, agenticReady, hints, dialogOpen, isOpen, openWhatsNew, setHints ] );

	useEffect( () => {
		return () => {
			if ( startTimerRef.current ) {
				clearTimeout( startTimerRef.current );
				startTimerRef.current = null;
			}
		};
	}, [] );
}
