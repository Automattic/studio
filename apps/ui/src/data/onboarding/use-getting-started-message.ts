import { __ } from '@wordpress/i18n';
import { useEffect, useRef, useState } from 'react';
import { useCoachmarks } from '@/components/coachmarks/coachmark-provider';
import { useOnboardingGuide } from '@/components/onboarding-guide/use-onboarding-guide';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import {
	useOnboardingCompleted,
	useOnboardingHints,
	useSetOnboardingHints,
} from '@/data/queries/use-onboarding-hints';
import { useSites } from '@/data/queries/use-sites';
import { deriveChecklistItems, getChecklistItems, isChecklistComplete } from './checklist';
import { ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import type { ChecklistItemId } from '@/data/core';
import type { ChecklistMessage } from '@/data/queries/use-app-messages';

export const GETTING_STARTED_MESSAGE_ID = 'getting-started';

// After the orientation guide is finished in this session, wait a beat before
// the checklist slides in, so it doesn't appear the instant the modal closes.
const CHECKLIST_REVEAL_DELAY_MS = 1200;

/**
 * The getting-started checklist card, or null when it shouldn't show (mid-NUX,
 * no sites, gate unresolved, dismissed, or the orientation guide hasn't been
 * seen yet). Clicking an item shows a coachmark that teaches where to click —
 * it never navigates for the user. Items check off from real events (see
 * use-onboarding-events).
 */
export function useGettingStartedMessage(): ChecklistMessage | null {
	const agentic = useAgenticFeatures();
	const { data: sites } = useSites();
	const { data: onboardingCompleted } = useOnboardingCompleted();
	const { data: hints } = useOnboardingHints();
	const setHints = useSetOnboardingHints();
	const { showCoachmark } = useCoachmarks();
	const { openGuide, isOpen: guideOpen } = useOnboardingGuide();

	const guideSeen =
		( hints?.tourCompletedVersion ?? 0 ) >= ORIENTATION_GUIDE_VERSION ||
		( hints?.tourDismissedVersion ?? 0 ) >= ORIENTATION_GUIDE_VERSION;

	// Reveal immediately for returning users (guide already seen before this
	// session); delay only for the transition right after the guide closes.
	const [ revealed, setRevealed ] = useState( false );
	const seenAtMountRef = useRef< boolean | null >( null );
	useEffect( () => {
		if ( hints === undefined ) {
			return;
		}
		if ( seenAtMountRef.current === null ) {
			seenAtMountRef.current = guideSeen;
			if ( guideSeen ) {
				setRevealed( true );
			}
		}
	}, [ hints, guideSeen ] );
	useEffect( () => {
		if ( revealed || seenAtMountRef.current !== false || ! guideSeen ) {
			return;
		}
		const timer = setTimeout( () => setRevealed( true ), CHECKLIST_REVEAL_DELAY_MS );
		return () => clearTimeout( timer );
	}, [ guideSeen, revealed ] );

	const ready =
		onboardingCompleted === true &&
		( sites?.length ?? 0 ) >= 1 &&
		agentic.isReady &&
		hints !== undefined &&
		! hints.checklistDismissed &&
		guideSeen &&
		revealed &&
		// Never share the stage with the welcome modal — including replays
		// (where guideSeen is already true). The card enters after it closes.
		! guideOpen;

	if ( ! ready ) {
		return null;
	}

	const defs = getChecklistItems( agentic.chatEnabled );
	const items = deriveChecklistItems( defs, hints );
	const allComplete = isChecklistComplete( items );
	const completedCount = items.filter( ( item ) => item.completed ).length;
	const variant = agentic.chatEnabled ? 'agentic' : 'overview';

	return {
		kind: 'checklist',
		id: GETTING_STARTED_MESSAGE_ID,
		title: allComplete ? __( 'You’re all set' ) : __( 'Getting started' ),
		items,
		completedCount,
		totalCount: items.length,
		minimized: hints.checklistMinimized === true,
		allComplete,
		onActivateItem: ( id: ChecklistItemId ) => {
			const def = defs.find( ( candidate ) => candidate.id === id );
			if ( def?.coachmark ) {
				showCoachmark( def.coachmark, { source: 'checklist' } );
			}
		},
		// Reopens the guide without re-arming auto-start: the persisted version
		// stays put, so this manual replay is the only effect.
		onReplayTour: () =>
			openGuide( variant, {
				onEnd: ( reason ) => {
					if ( reason === 'completed' ) {
						setHints.mutate( { tourCompletedVersion: ORIENTATION_GUIDE_VERSION } );
					} else {
						setHints.mutate( { tourDismissedVersion: ORIENTATION_GUIDE_VERSION } );
					}
				},
			} ),
		onToggleMinimized: () =>
			setHints.mutate( { checklistMinimized: ! ( hints.checklistMinimized === true ) } ),
		onDismiss: () => setHints.mutate( { checklistDismissed: true } ),
	};
}
