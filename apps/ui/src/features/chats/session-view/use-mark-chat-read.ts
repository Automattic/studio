import { useEffect, useEffectEvent, useRef } from 'react';
import { useUpdateSessionMetadata } from '@/data/queries/use-sessions';
import type { AiSessionSummary } from '@/data/core';

// Clears a chat's unread flag while it is on screen in a focused window: when
// it opens, when its window comes back, and when a turn ends as you watch (the
// host marks the chat unread as the run exits). Marking the open chat unread by
// hand sticks until one of those happens again.
export function useMarkChatRead(
	sessionId: string | undefined,
	summary: AiSessionSummary | undefined,
	hasActiveRun: boolean
) {
	const { mutate } = useUpdateSessionMetadata();
	const loaded = !! summary;
	const unread = !! summary?.unread;
	const markRead = useEffectEvent( () => {
		if ( sessionId && unread && document.visibilityState === 'visible' && document.hasFocus() ) {
			mutate( { sessionId, patch: { unread: false } } );
		}
	} );

	useEffect( () => {
		if ( ! loaded ) {
			return;
		}
		const onView = () => markRead();
		onView();
		window.addEventListener( 'focus', onView );
		document.addEventListener( 'visibilitychange', onView );
		return () => {
			window.removeEventListener( 'focus', onView );
			document.removeEventListener( 'visibilitychange', onView );
		};
	}, [ loaded, sessionId ] );

	const runEnded = useRef( false );
	const wasActive = useRef( hasActiveRun );
	useEffect( () => {
		runEnded.current ||= wasActive.current && ! hasActiveRun;
		wasActive.current = hasActiveRun;
	}, [ hasActiveRun ] );
	useEffect( () => {
		if ( unread && runEnded.current ) {
			runEnded.current = false;
			markRead();
		}
	}, [ unread ] );
}
