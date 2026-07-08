import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { isLabMessageActive, toggleLabMessage } from '@/data/dev-lab-messages';
import { deriveChecklistItems, getChecklistItems } from '@/data/onboarding/checklist';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import { APP_UPDATE_STATUS_QUERY_KEY } from '@/data/queries/use-app-update';
import {
	markChecklistItemComplete,
	ONBOARDING_HINTS_QUERY_KEY,
	useOnboardingHints,
} from '@/data/queries/use-onboarding-hints';
import styles from './style.module.css';
import type { AppUpdateStatus, OnboardingHintsState } from '@/data/core';

// Dev-only message lab (the QA panel STU-1984 asks for): fires every toast
// variant and toggles simulated persistent cards, so the sidebar stack —
// getting-started checklist, update card, announcements, toasts — can be
// exercised without real failures. Mounted behind import.meta.env.DEV; copy
// is deliberately unlocalized.

// Fresh fake version per injection so a persisted dismissal of the previous
// one never hides the next.
let updateCounter = 0;

const UPSELL_MESSAGE_ID = 'lab-upsell';

function fireToastBurst() {
	toast.success( 'Site started' );
	toast.info( 'Import finished' );
	toast.error( "Push didn't complete", {
		description: 'Port 8899 is already in use.',
	} );
	toast.success( 'Settings saved' );
	toast.info( 'Snapshot created' );
}

export function DevMessageLab() {
	const [ open, setOpen ] = useState( false );
	const queryClient = useQueryClient();
	const connector = useConnector();
	const agentic = useAgenticFeatures();
	const { data: hints } = useOnboardingHints();

	// Simulate checklist progress (the real events — agent runs, pushes —
	// aren't available in a sim/new-user environment).
	const checklistItems = deriveChecklistItems( getChecklistItems( agentic.enabled ), hints );
	const nextIncomplete = checklistItems.find( ( item ) => ! item.completed );
	const completeNextItem = () => {
		if ( nextIncomplete ) {
			void markChecklistItemComplete( connector, queryClient, nextIncomplete.id );
		}
	};
	const completeAllItems = () => {
		for ( const item of checklistItems ) {
			if ( ! item.completed ) {
				void markChecklistItemComplete( connector, queryClient, item.id );
			}
		}
	};
	// Session-only: clears the query cache so the UI resets, but the persisted
	// completions in app.json survive a relaunch. Good enough for QA.
	const resetItems = () => {
		queryClient.setQueryData(
			ONBOARDING_HINTS_QUERY_KEY,
			( current: OnboardingHintsState | undefined ) => ( {
				...( current ?? {} ),
				completedItems: {},
			} )
		);
	};

	const toggleUpdateCard = () => {
		const current = queryClient.getQueryData< AppUpdateStatus >( APP_UPDATE_STATUS_QUERY_KEY );
		if ( current?.readyToInstall && current.version?.startsWith( '9.9.' ) ) {
			queryClient.setQueryData( APP_UPDATE_STATUS_QUERY_KEY, {
				readyToInstall: false,
				version: null,
			} );
		} else {
			updateCounter += 1;
			queryClient.setQueryData( APP_UPDATE_STATUS_QUERY_KEY, {
				readyToInstall: true,
				version: `9.9.${ updateCounter }`,
			} );
		}
	};

	const toggleUpsellCard = () => {
		toggleLabMessage( {
			id: UPSELL_MESSAGE_ID,
			intent: 'success',
			title: '50% off WordPress.com hosting',
			description: 'Publish with a free domain for a year. Ends Friday.',
			cta: { label: 'See the deal', onClick: () => toast.info( 'Upsell CTA clicked' ) },
			// Session-only dismissal so the toggle keeps working after a dismiss.
			persistDismissal: false,
		} );
	};

	if ( ! open ) {
		return (
			<button type="button" className={ styles.pill } onClick={ () => setOpen( true ) }>
				Message lab
			</button>
		);
	}

	return (
		<div className={ styles.panel }>
			<div className={ styles.panelHeader }>
				<span className={ styles.panelTitle }>Message lab</span>
				<button type="button" className={ styles.panelClose } onClick={ () => setOpen( false ) }>
					Close
				</button>
			</div>
			<div className={ styles.section }>
				<span className={ styles.sectionLabel }>Toasts</span>
				<button type="button" onClick={ () => toast.success( 'Site started' ) }>
					Success
				</button>
				<button
					type="button"
					onClick={ () =>
						toast.error( "Push didn't complete", {
							description: 'Port 8899 is already in use.',
						} )
					}
				>
					Error + detail
				</button>
				<button
					type="button"
					onClick={ () =>
						toast.info( 'Import finished', {
							action: { label: 'View logs', onClick: () => toast.success( 'Logs opened' ) },
						} )
					}
				>
					With action
				</button>
				<button type="button" onClick={ fireToastBurst }>
					Burst of 5
				</button>
			</div>
			<div className={ styles.section }>
				<span className={ styles.sectionLabel }>Cards</span>
				<button type="button" onClick={ toggleUpdateCard }>
					Toggle update card
				</button>
				<button type="button" onClick={ toggleUpsellCard }>
					{ isLabMessageActive( UPSELL_MESSAGE_ID ) ? 'Remove upsell card' : 'Show upsell card' }
				</button>
			</div>
			<div className={ styles.section }>
				<span className={ styles.sectionLabel }>Checklist</span>
				<button type="button" onClick={ completeNextItem } disabled={ ! nextIncomplete }>
					{ nextIncomplete ? `Complete “${ nextIncomplete.label }”` : 'All complete' }
				</button>
				<button type="button" onClick={ completeAllItems } disabled={ ! nextIncomplete }>
					Complete all
				</button>
				<button type="button" onClick={ resetItems }>
					Reset items (session only)
				</button>
			</div>
		</div>
	);
}
