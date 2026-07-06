import { isStudioChatArtifactData } from '@studio/common/ai/chat-artifacts';
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
			if ( event.type === 'preview.reload' ) {
				dispatch( { type: 'preview/reload' } );
				return;
			}
			if ( event.type === 'chat.artifact' && isStudioChatArtifactData( event.artifact ) ) {
				const previewPath = getSitePreviewArtifactPath( event.artifact );
				if ( previewPath ) {
					dispatch( { type: 'preview/navigate', path: previewPath } );
				}
			}
		} );
	}, [ connector, sessionId, dispatch ] );
}

function getSitePreviewArtifactPath( artifact: {
	widgets: Array< { type: string; widgetProps: Record< string, unknown > } >;
} ): string | null {
	const widget = artifact.widgets.find(
		( candidate ) =>
			candidate.type === 'site-preview' && typeof candidate.widgetProps.path === 'string'
	);
	return typeof widget?.widgetProps.path === 'string' ? widget.widgetProps.path : null;
}
