import { randomUUID } from 'node:crypto';
import {
	STUDIO_CHAT_ARTIFACT_VERSION,
	type StudioChatArtifactData,
	type StudioChatSitePreviewArtifact,
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

export async function emitSitePreviewArtifact(
	sitePreview: StudioChatSitePreviewArtifact | undefined
): Promise< StudioChatArtifactData | null > {
	if ( ! sitePreview ) {
		return null;
	}

	const artifact: StudioChatArtifactData = {
		version: STUDIO_CHAT_ARTIFACT_VERSION,
		id: randomUUID(),
		sitePreview: { ...sitePreview },
	};

	await emitChatArtifact( artifact );
	return artifact;
}
