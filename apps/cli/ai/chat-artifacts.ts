import { randomUUID } from 'node:crypto';
import {
	STUDIO_CHAT_ARTIFACT_VERSION,
	type StudioChatArtifactData,
	type StudioChatArtifactWidgetDraft,
} from '@studio/common/ai/chat-artifacts';
import { emitEvent } from 'cli/ai/json-events';

type ChatArtifactCallback = ( artifact: StudioChatArtifactData ) => void | Promise< void >;

let chatArtifactCallback: ChatArtifactCallback | null = null;

export function setChatArtifactCallback( callback: ChatArtifactCallback | null ) {
	chatArtifactCallback = callback;
}

export async function emitChatArtifact( artifact: StudioChatArtifactData ): Promise< void > {
	await chatArtifactCallback?.( artifact );
	emitEvent( {
		type: 'chat.artifact',
		timestamp: new Date().toISOString(),
		artifact,
	} );
}

export async function emitChatArtifactWidgets(
	widgets: readonly StudioChatArtifactWidgetDraft[] | undefined
): Promise< StudioChatArtifactData | null > {
	const artifactWidgets = cloneChatArtifactWidgets( widgets );
	if ( artifactWidgets.length === 0 ) {
		return null;
	}

	const artifact: StudioChatArtifactData = {
		version: STUDIO_CHAT_ARTIFACT_VERSION,
		id: randomUUID(),
		widgets: artifactWidgets,
	};

	await emitChatArtifact( artifact );
	return artifact;
}

function cloneChatArtifactWidgets(
	widgets: readonly StudioChatArtifactWidgetDraft[] | undefined
): StudioChatArtifactWidgetDraft[] {
	if ( ! widgets?.length ) {
		return [];
	}

	return widgets.map( ( widget ) => ( {
		type: widget.type,
		widgetProps: { ...widget.widgetProps },
		...( widget.shapeProps ? { shapeProps: { ...widget.shapeProps } } : {} ),
	} ) );
}
