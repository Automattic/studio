import { useQueryClient } from '@tanstack/react-query';
import { useRouterState } from '@tanstack/react-router';
import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { useCoachmarks } from '@/components/coachmarks/coachmark-provider';
import { useOnboardingGuide } from '@/components/onboarding-guide/use-onboarding-guide';
import { useConnector } from '@/data/core';
import { useAgentRunStore } from '@/data/queries/use-agent-run';
import { useAgenticFeatures } from '@/data/queries/use-agentic-features';
import {
	markChecklistItemComplete,
	useOnboardingHints,
	writeOnboardingHints,
} from '@/data/queries/use-onboarding-hints';
import { PUSH_TO_LIVE_MUTATION_KEY } from '@/data/queries/use-sync-site';
import { ORIENTATION_GUIDE_VERSION } from './orientation-guide';
import type { CoachmarkContent } from './types';
import type { OpenGuide } from '@/components/onboarding-guide/use-onboarding-guide';
import type { OnboardingHintsState } from '@/data/core';

// Fired once after the first successful agent edit (agentic mode only).
const PUBLISH_COACHMARK: CoachmarkContent = {
	anchor: 'publish-button',
	title: () => __( 'Ready to go live?' ),
	description: () => __( 'Publish puts this site on WordPress.com whenever you’re ready.' ),
	placement: { side: 'bottom', align: 'end' },
};

// Small delay after a run completes so the coachmark doesn't collide with the
// agent's response landing in the conversation.
const PUBLISH_COACHMARK_DELAY_MS = 1500;

function sameMutationKey( key: unknown ): boolean {
	return (
		Array.isArray( key ) &&
		key.length === PUSH_TO_LIVE_MUTATION_KEY.length &&
		key.every( ( part, index ) => part === PUSH_TO_LIVE_MUTATION_KEY[ index ] )
	);
}

/**
 * App-wide onboarding watchers. Mounted once, above the router:
 * - completes "make a change with chat" on the first successful agent run and
 *   fires the one-shot publish coachmark;
 * - completes "publish" when a push to WordPress.com succeeds;
 * - restores the getting-started checklist when the user picks Help ▸ Getting
 *   Started in the application menu.
 */
export function useOnboardingEvents(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const store = useAgentRunStore();
	const agentic = useAgenticFeatures();
	const { data: hints } = useOnboardingHints();
	const { active, showCoachmark } = useCoachmarks();
	const { openGuide } = useOnboardingGuide();

	// Kept in refs so the subscriptions below survive re-renders without
	// resubscribing, while still reading the latest gate/hints/active values.
	const agenticEnabledRef = useRef( agentic.chatEnabled );
	const hintsRef = useRef< OnboardingHintsState | undefined >( hints );
	const hasActiveRef = useRef( active !== null );
	const showCoachmarkRef = useRef( showCoachmark );
	const openGuideRef = useRef< OpenGuide >( openGuide );
	useEffect( () => {
		agenticEnabledRef.current = agentic.chatEnabled;
		hintsRef.current = hints;
		hasActiveRef.current = active !== null;
		showCoachmarkRef.current = showCoachmark;
		openGuideRef.current = openGuide;
	}, [ agentic.chatEnabled, hints, active, showCoachmark, openGuide ] );

	// First successful agent run → complete the checklist item, and (agentic
	// only) fire the publish coachmark once.
	useEffect( () => {
		let previous = store.stateStore.getState();
		const handledRunIds = new Set< string >();
		const timers = new Set< ReturnType< typeof setTimeout > >();

		const unsubscribe = store.stateStore.subscribe( () => {
			const next = store.stateStore.getState();
			for ( const sessionId of Object.keys( next ) ) {
				const nextState = next[ sessionId ];
				const previousState = previous[ sessionId ];
				if ( nextState === previousState ) {
					continue;
				}
				const previousPhase = previousState?.phase ?? 'idle';
				const succeeded =
					nextState.phase === 'winding_down' &&
					( previousPhase === 'starting' || previousPhase === 'running' ) &&
					nextState.queuedPrompts.length === 0 &&
					nextState.error === null &&
					nextState.runId !== null &&
					! handledRunIds.has( nextState.runId );
				if ( ! succeeded ) {
					continue;
				}
				handledRunIds.add( nextState.runId as string );
				void markChecklistItemComplete( connector, queryClient, 'first-agent-edit' );

				// One-shot publish coachmark. Persist "shown" up front so it never
				// fires twice; if the publish button isn't present (connected or
				// plugin site) the coachmark layer aborts silently.
				if (
					agenticEnabledRef.current &&
					! hintsRef.current?.publishCoachmarkShown &&
					! hasActiveRef.current
				) {
					void writeOnboardingHints( connector, queryClient, { publishCoachmarkShown: true } );
					const timer = setTimeout( () => {
						timers.delete( timer );
						if ( ! hasActiveRef.current ) {
							showCoachmarkRef.current( PUBLISH_COACHMARK, { source: 'event' } );
						}
					}, PUBLISH_COACHMARK_DELAY_MS );
					timers.add( timer );
				}
			}
			previous = next;
		} );

		return () => {
			unsubscribe();
			for ( const timer of timers ) {
				clearTimeout( timer );
			}
		};
	}, [ store, connector, queryClient ] );

	// Push to WordPress.com succeeded → complete the publish checklist item.
	useEffect( () => {
		return queryClient.getMutationCache().subscribe( ( event ) => {
			const mutation = event?.mutation;
			if (
				mutation &&
				sameMutationKey( mutation.options.mutationKey ) &&
				mutation.state.status === 'success'
			) {
				void markChecklistItemComplete( connector, queryClient, 'publish-site' );
			}
		} );
	}, [ queryClient, connector ] );

	// Help ▸ Getting Started → reopen the orientation guide (the visible
	// "start over"), and restore the checklist so it's waiting afterward.
	useEffect( () => {
		return connector.onShowGettingStarted( () => {
			void writeOnboardingHints( connector, queryClient, {
				checklistDismissed: false,
				checklistMinimized: false,
			} );
			const variant = agenticEnabledRef.current ? 'agentic' : 'overview';
			openGuideRef.current( variant, {
				onEnd: ( reason ) => {
					void writeOnboardingHints(
						connector,
						queryClient,
						reason === 'completed'
							? { tourCompletedVersion: ORIENTATION_GUIDE_VERSION }
							: { tourDismissedVersion: ORIENTATION_GUIDE_VERSION }
					);
				},
			} );
		} );
	}, [ connector, queryClient ] );
}

const OVERVIEW_PATH = /^\/sites\/[^/]+\/overview\b/;
const SITE_SETTINGS_PATH = /^\/sites\/[^/]+\/settings\b/;
const APP_SETTINGS_PATH = /^\/settings\b/;

/**
 * Route-visit completions. Mounted inside the dashboard layout (which hosts the
 * overview, settings, and site-settings routes), so it has router access.
 */
export function useOnboardingRouteEvents(): void {
	const connector = useConnector();
	const queryClient = useQueryClient();
	const pathname = useRouterState( { select: ( state ) => state.location.pathname } );

	useEffect( () => {
		if ( APP_SETTINGS_PATH.test( pathname ) ) {
			void markChecklistItemComplete( connector, queryClient, 'visit-app-settings' );
		} else if ( SITE_SETTINGS_PATH.test( pathname ) ) {
			void markChecklistItemComplete( connector, queryClient, 'visit-site-settings' );
		} else if ( OVERVIEW_PATH.test( pathname ) ) {
			void markChecklistItemComplete( connector, queryClient, 'visit-overview' );
		}
	}, [ pathname, connector, queryClient ] );
}
