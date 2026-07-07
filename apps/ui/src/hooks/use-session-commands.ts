import { isStudioChatArtifactData } from '@studio/common/ai/chat-artifacts';
import { useEffect } from 'react';
import { useConnector } from '@/data/core';
import { useSessionUIDispatch } from './use-session-ui';
import type { AgentMarker } from '@studio/common/inspector/protocol';

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
			if ( event.type === 'preview.highlight' ) {
				dispatch( {
					type: 'preview-agent-markers/set',
					markers: sanitizeAgentMarkers( event.markers ),
				} );
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

// Agent events cross a process boundary; keep only well-formed markers and
// cap the count so a runaway tool call can't wallpaper the preview.
function sanitizeAgentMarkers( markers: unknown ): AgentMarker[] {
	if ( ! Array.isArray( markers ) ) {
		return [];
	}
	return markers
		.filter(
			( marker ): marker is { id?: unknown; selector?: unknown; label?: unknown } =>
				!! marker && typeof marker === 'object'
		)
		.filter( ( marker ) => typeof marker.selector === 'string' && marker.selector.trim() !== '' )
		.slice( 0, 20 )
		.map( ( marker, index ) => ( {
			id: typeof marker.id === 'string' ? marker.id : `agent-${ index + 1 }`,
			selector: marker.selector as string,
			label: typeof marker.label === 'string' ? marker.label : undefined,
		} ) );
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
