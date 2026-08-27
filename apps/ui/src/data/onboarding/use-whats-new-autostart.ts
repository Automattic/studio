import { hasUnseenWhatsNew } from '@studio/common/lib/whats-new';
import { useEffect, useRef } from 'react';
import { useOnboardingGuide } from '@/components/onboarding-guide/use-onboarding-guide';
import { useOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { useSites } from '@/data/queries/use-sites';
import {
	useLastSeenVersion,
	useSaveLastSeenVersion,
	useWhatsNewVersion,
} from '@/data/queries/use-whats-new-seen';
import { ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import { getWhatsNewGuide } from './whats-new';
import type { OnboardingHintsState } from '@/data/core';

interface AutostartInputs {
	siteCount: number;
	hints: OnboardingHintsState | undefined;
	lastSeenVersion: string | null | undefined;
	currentVersion: string | undefined;
	guideOpen: boolean;
	alreadyStarted: boolean;
}

export type WhatsNewAutostart = 'show' | 'mark-seen' | null;

/**
 * Pure decision: whether to auto-open the announcements. Returns null unless the
 * user has at least one site, the stored marker has loaded, nothing is already
 * showing, and this app session hasn't opened the guide yet.
 */
export function deriveWhatsNewAutostart( {
	siteCount,
	hints,
	lastSeenVersion,
	currentVersion,
	guideOpen,
	alreadyStarted,
}: AutostartInputs ): WhatsNewAutostart {
	if ( alreadyStarted || guideOpen ) {
		return null;
	}
	// Having a site is the real "past the NUX" signal — see the note in
	// use-orientation-autostart.ts for why `onboardingCompleted` can't be used.
	if ( siteCount < 1 ) {
		return null;
	}
	if ( hints === undefined || lastSeenVersion === undefined || currentVersion === undefined ) {
		return null;
	}
	if ( ! hasUnseenWhatsNew( lastSeenVersion ?? undefined, currentVersion ) ) {
		return null;
	}
	// A first arrival in the workbench belongs to the orientation guide, and none
	// of this is news to someone seeing the app for the first time — bank the
	// version so it only interrupts on the next release with new content. This
	// also keeps the two exclusive: orientation autostarts on exactly the state
	// that returns 'mark-seen'.
	const orientationSeen =
		( hints.tourCompletedVersion ?? 0 ) >= ORIENTATION_GUIDE_VERSION ||
		( hints.tourDismissedVersion ?? 0 ) >= ORIENTATION_GUIDE_VERSION;
	return orientationSeen ? 'show' : 'mark-seen';
}

// Matches the orientation guide's entrance delay, so the modal reads as arriving
// rather than as part of the initial paint.
const GUIDE_START_DELAY_MS = 500;

/**
 * Auto-opens the What's New guide when there are unseen announcements. Mounted
 * in the dashboard layout.
 */
export function useWhatsNewAutostart(): void {
	const { data: sites } = useSites();
	const { data: hints } = useOnboardingHints();
	const { data: lastSeenVersion } = useLastSeenVersion();
	const saveLastSeenVersion = useSaveLastSeenVersion();
	const { isOpen, openGuide } = useOnboardingGuide();

	const currentVersion = useWhatsNewVersion();
	const startedRef = useRef( false );
	const startTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );

	useEffect( () => {
		if ( currentVersion === undefined ) {
			return;
		}
		const decision = deriveWhatsNewAutostart( {
			siteCount: sites?.length ?? 0,
			hints,
			lastSeenVersion,
			currentVersion,
			guideOpen: isOpen,
			alreadyStarted: startedRef.current,
		} );
		if ( ! decision ) {
			return;
		}
		startedRef.current = true;
		if ( decision === 'mark-seen' ) {
			saveLastSeenVersion.mutate( currentVersion );
			return;
		}
		startTimerRef.current = setTimeout( () => {
			startTimerRef.current = null;
			openGuide( getWhatsNewGuide(), {
				// Skipping counts as seen: these are announcements, not a task, and
				// re-interrupting someone who closed them is worse than them missing one.
				onEnd: () => saveLastSeenVersion.mutate( currentVersion ),
			} );
		}, GUIDE_START_DELAY_MS );
		// No timer cleanup here: a dependency change re-runs this effect and
		// returns early (startedRef guard); clearing on every re-run would
		// cancel the pending open. The mount-scoped cleanup below handles it.
	}, [
		sites?.length,
		hints,
		lastSeenVersion,
		currentVersion,
		isOpen,
		openGuide,
		saveLastSeenVersion,
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
