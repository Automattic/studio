import { __ } from '@wordpress/i18n';
import { isKeyboardEvent } from '@wordpress/keycodes';
import { useEffect } from 'react';
import type { AiSessionSummary } from '@/data/core';

export function getSessionTitle( session: AiSessionSummary ): string {
	const title = session.title?.trim() || session.firstPrompt?.trim() || __( 'New chat' );
	return title.charAt( 0 ).toLocaleUpperCase() + title.slice( 1 );
}

// ⌘N (Ctrl+N elsewhere) starts a new chat for the site in view.
export function useNewChatShortcut( onNewChat: () => void, enabled: boolean ) {
	useEffect( () => {
		if ( ! enabled ) {
			return;
		}
		const handleKeyDown = ( event: KeyboardEvent ) => {
			if ( event.defaultPrevented || event.repeat || ! isKeyboardEvent.primary( event, 'n' ) ) {
				return;
			}
			event.preventDefault();
			onNewChat();
		};
		document.addEventListener( 'keydown', handleKeyDown, { capture: true } );
		return () => document.removeEventListener( 'keydown', handleKeyDown, { capture: true } );
	}, [ enabled, onNewChat ] );
}
