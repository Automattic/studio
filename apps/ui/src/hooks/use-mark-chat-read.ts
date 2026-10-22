import { useEffect } from 'react';
import { useUpdateSessionMetadata } from '@/data/queries/use-sessions';

// Clears a chat's unread flag while it is on screen in a focused window, so a
// turn that finishes while you watch never reads as new.
export function useMarkChatRead( sessionId: string, unread: boolean | undefined ) {
	const { mutate } = useUpdateSessionMetadata();
	useEffect( () => {
		if ( ! unread ) {
			return;
		}
		const markRead = () => {
			if ( document.visibilityState === 'visible' && document.hasFocus() ) {
				mutate( { sessionId, patch: { unread: false } } );
			}
		};
		markRead();
		window.addEventListener( 'focus', markRead );
		document.addEventListener( 'visibilitychange', markRead );
		return () => {
			window.removeEventListener( 'focus', markRead );
			document.removeEventListener( 'visibilitychange', markRead );
		};
	}, [ mutate, sessionId, unread ] );
}
