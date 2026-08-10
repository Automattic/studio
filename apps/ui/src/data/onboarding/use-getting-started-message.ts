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
import { getOrientationGuide, ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import type { ChecklistCardItem } from './checklist';
import type { ChecklistItemId } from '@/data/core';

// View-model the getting-started card renders. Standalone (option b) — it does
// not ride the app-message store, so its dismissal persists via onboardingHints.
export interface GettingStartedChecklistView {
	title: string;
	items: ChecklistCardItem[];
	completedCount: number;
	totalCount: number;
	minimized: boolean;
	allComplete: boolean;
	// Clicking an incomplete item shows a coachmark pointing at the real
	// control — it never navigates for the user.
	onActivateItem: ( id: ChecklistItemId ) => void;
	onReplayTour: () => void;
	onToggleMinimized: () => void;
	onDismiss: () => void;
}

// After the orientation guide is finished in this session, wait a beat before
// the checklist slides in, so it doesn't appear the instant the modal closes.
const CHECKLIST_REVEAL_DELAY_MS = 1200;

/**
 * The getting-started checklist view-model, or null when it shouldn't show
 * (mid-NUX, no sites, gate unresolved, dismissed, or the orientation guide
 * hasn't been seen yet). Items check off from real events (see
 * use-onboarding-events), not from clicking.
 */
export function useGettingStartedMessage(): GettingStartedChecklistView | null {
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

	// Reveal immediately when the guide was already seen before this session;
	// delay only for the transition right after the guide closes.
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

	// Migrating users skip the fresh-install welcome (they already had sites), so
	// treat their marker as satisfying that precondition.
	const welcomeDone = onboardingCompleted === true || hints?.migratedFromClassic === true;

	const ready =
		welcomeDone &&
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
	const guideVariant = {
		migrating: hints.migratedFromClassic === true,
		chatEnabled: agentic.chatEnabled,
	};

	return {
		title: allComplete ? __( 'You’re all set' ) : __( 'Getting started' ),
		items,
		completedCount,
		totalCount: items.length,
		minimized: hints.checklistMinimized === true,
		allComplete,
		onActivateItem: ( id: ChecklistItemId ) => {
			const def = defs.find( ( candidate ) => candidate.id === id );
			if ( def?.coachmark ) {
				showCoachmark( def.coachmark );
			}
		},
		// Reopens the guide without re-arming auto-start: the persisted version
		// stays put, so this manual replay is the only effect.
		onReplayTour: () =>
			openGuide( getOrientationGuide( guideVariant ), {
				onEnd: ( reason ) => {
					setHints.mutate(
						reason === 'completed'
							? { tourCompletedVersion: ORIENTATION_GUIDE_VERSION }
							: { tourDismissedVersion: ORIENTATION_GUIDE_VERSION }
					);
				},
			} ),
		onToggleMinimized: () =>
			setHints.mutate( { checklistMinimized: ! ( hints.checklistMinimized === true ) } ),
		onDismiss: () => setHints.mutate( { checklistDismissed: true } ),
	};
}
