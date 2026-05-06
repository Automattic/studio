import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import { useSessionUIDispatch } from './use-session-ui';

// Bridge from the chat event stream to SessionUI state. No state of its own —
// purely the wiring that turns agent events into UI actions. Add a new
// agent → UI behavior by handling its event type here and dispatching the
// matching action defined in `use-session-ui`.
export function useSessionCommands( sessionId: string ): void {
	const connector = useConnector();
	const dispatch = useSessionUIDispatch();

	useEffect( () => {
		return connector.onAgentEvent( ( payload ) => {
			if ( payload.sessionId !== sessionId ) return;
			const event = payload.event;
			if ( event.type === 'preview.command' ) {
				if ( event.kind === 'navigate' ) {
					dispatch( { type: 'preview/navigate', path: event.path } );
				} else if ( event.kind === 'reload' ) {
					dispatch( { type: 'preview/reload' } );
				}
			}
		} );
	}, [ connector, sessionId, dispatch ] );
}
