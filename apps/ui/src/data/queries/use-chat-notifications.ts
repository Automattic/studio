import { __ } from '@wordpress/i18n';
import { useEffect, useRef } from 'react';
import { useConnector } from '@/data/core';
import { useAgentRunStore } from '@/data/queries/use-agent-run';
import { useSessions } from '@/data/queries/use-sessions';
import { useUserPreferences } from '@/data/queries/use-user-preferences';
import { getVisibleSessionId } from '@/lib/visible-session';
import type { AiSessionSummary, ChatNotification } from '@/data/core';
import type { AgentRunSessionState } from '@/data/queries/use-agent-run';

function countUnanswered( state: AgentRunSessionState ): number {
	return state.pendingQuestions.filter(
		( pendingQuestion ) => typeof state.pendingAnswers[ pendingQuestion.question ] !== 'string'
	).length;
}

function notificationTitle( sessions: AiSessionSummary[] | undefined, sessionId: string ): string {
	const summary = sessions?.find( ( session ) => session.id === sessionId );
	return summary?.ownerSiteName ?? __( 'Studio' );
}

/**
 * Watches every session's live-run state and asks the host to show an OS
 * notification when a chat finishes its response or is waiting on the user's
 * answer to a question. A notification is suppressed only when the user is
 * already looking at that conversation — window focused AND that session on
 * screen. Working on another site (or another app) still notifies.
 *
 * Subscribes to the store imperatively rather than via `useSyncExternalStore`
 * — notifications are a side effect, and re-rendering on every dispatch would
 * defeat the store's per-session render isolation.
 */
export function useChatNotifications(): void {
	const connector = useConnector();
	const store = useAgentRunStore();
	const { data: preferences } = useUserPreferences();
	const { data: sessions } = useSessions();

	// Kept in refs so the store subscription below survives preference and
	// session-list refetches without resubscribing (and re-snapshotting).
	const preferencesRef = useRef( preferences );
	const sessionsRef = useRef( sessions );
	useEffect( () => {
		preferencesRef.current = preferences;
		sessionsRef.current = sessions;
	}, [ preferences, sessions ] );

	useEffect( () => {
		let previous = store.stateStore.getState();
		// Runs whose completion we already announced, so the `winding_down`
		// entry fires at most once per run.
		const notifiedRunIds = new Set< string >();

		return store.stateStore.subscribe( () => {
			const next = store.stateStore.getState();
			const enabled = preferencesRef.current?.chatNotificationsEnabled ?? true;

			for ( const sessionId of Object.keys( next ) ) {
				const nextState = next[ sessionId ];
				const previousState = previous[ sessionId ];
				if ( nextState === previousState ) {
					continue;
				}

				let notification: ChatNotification | null = null;

				// Response finished: the turn completed (`winding_down` entry).
				// `run_ended` later transitions to `idle` for the same run and
				// must stay silent — keying off this edge alone prevents the
				// double fire. A non-empty queue means a staged follow-up will
				// auto-dispatch, so the agent isn't actually done yet.
				const previousPhase = previousState?.phase ?? 'idle';
				if (
					nextState.phase === 'winding_down' &&
					( previousPhase === 'starting' || previousPhase === 'running' ) &&
					nextState.queuedPrompts.length === 0 &&
					nextState.runId !== null &&
					! notifiedRunIds.has( nextState.runId )
				) {
					notifiedRunIds.add( nextState.runId );
					notification = {
						sessionId,
						kind: 'response-complete',
						title: notificationTitle( sessionsRef.current, sessionId ),
						body: __( 'Finished responding' ),
					};
				}

				// Pending question: the unanswered count crossed zero. Each new
				// batch is a real request for attention, so no per-run dedupe.
				const previousUnanswered = previousState ? countUnanswered( previousState ) : 0;
				if ( previousUnanswered === 0 && countUnanswered( nextState ) > 0 ) {
					notification = {
						sessionId,
						kind: 'pending-question',
						title: notificationTitle( sessionsRef.current, sessionId ),
						body: __( 'Waiting for your input' ),
					};
				}

				// The user already sees this conversation — nothing to announce.
				const isWatchingSession = document.hasFocus() && getVisibleSessionId() === sessionId;

				if ( notification && enabled && ! isWatchingSession ) {
					void connector.showChatNotification( notification );
				}
			}

			previous = next;
		} );
	}, [ connector, store ] );
}
