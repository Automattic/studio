import { hasUnseenWhatsNew } from '@studio/common/lib/whats-new';
import { useEffect, useRef } from 'react';
import { useOnboardingGuide } from '@/components/onboarding-guide/use-onboarding-guide';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { useOnboardingHints } from '@/data/queries/use-onboarding-hints';
import { useSites } from '@/data/queries/use-sites';
import { useLastSeenVersion, useSaveLastSeenVersion } from '@/data/queries/use-whats-new-seen';
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

// 'show' opens the announcements; 'mark-seen' records them without showing.
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
	if ( hints === undefined || lastSeenVersion === undefined ) {
		return null;
	}
	if ( ! hasUnseenWhatsNew( lastSeenVersion ?? undefined, currentVersion ) ) {
		return null;
	}
	// Someone who hasn't been through the orientation guide is arriving in the
	// workbench for the first time — every announcement here is news to them, and
	// orientation owns that moment. Bank the current version so the announcements
	// only interrupt on the *next* release that ships new content. This also keeps
	// the two guides mutually exclusive: orientation autostarts exactly when this
	// returns 'mark-seen'.
	const orientationSeen =
		( hints.tourCompletedVersion ?? 0 ) >= ORIENTATION_GUIDE_VERSION ||
		( hints.tourDismissedVersion ?? 0 ) >= ORIENTATION_GUIDE_VERSION;
	return orientationSeen ? 'show' : 'mark-seen';
}

// Matches the orientation guide's entrance delay, so the modal reads as arriving
// rather than as part of the initial paint.
const GUIDE_START_DELAY_MS = 500;

// Browser targets have no app version to record. A fixed stand-in keeps the
// marker truthy so the announcements don't reappear on every load.
const BROWSER_VERSION = 'browser';

/**
 * Auto-opens the What's New guide when there are unseen announcements. Mounted
 * in the dashboard layout.
 */
export function useWhatsNewAutostart(): void {
	const { data: sites } = useSites();
	const { data: hints } = useOnboardingHints();
	const { data: appGlobals } = useAppGlobals();
	const { data: lastSeenVersion } = useLastSeenVersion();
	const saveLastSeenVersion = useSaveLastSeenVersion();
	const { isOpen, openGuide } = useOnboardingGuide();

	const currentVersion = appGlobals?.appVersion ?? BROWSER_VERSION;
	const startedRef = useRef( false );
	const startTimerRef = useRef< ReturnType< typeof setTimeout > | null >( null );

	useEffect( () => {
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
		// Mark started immediately so a dependency change can't schedule twice.
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
