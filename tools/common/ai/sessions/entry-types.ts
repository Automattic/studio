// Studio metadata rides as `studio.*` `customType` entries on top of pi's
// `SessionEntry` schema. The renderer never imports pi at runtime — these
// types are only used at the type-check boundary (`import type` is erased).

import type { StudioChatArtifactData } from '../chat-artifacts';
import type { StudioChatImageAttachment } from '../chat-images';
import type { CustomEntry, SessionEntry } from '@earendil-works/pi-coding-agent';

export type StudioCustomEntryType =
	| 'studio.site_selected'
	| 'studio.tool_progress'
	| 'studio.chat_artifact'
	| 'studio.agent_question'
	| 'studio.turn_closed'
	| 'studio.session_context'
	| 'studio.user_prompt';

export interface StudioSiteSelectedData {
	siteName: string;
	sitePath: string;
	remote?: boolean;
	url?: string;
	wpcomSiteId?: number;
}

export interface StudioToolProgressData {
	message: string;
}

export interface StudioAgentQuestionData {
	question: string;
	options: Array< { label: string; description: string } >;
	selectedLabel?: string;
}

export type StudioTurnStatus = 'success' | 'error' | 'max_turns' | 'interrupted';

export interface StudioTurnClosedData {
	status: StudioTurnStatus;
}

export interface StudioSessionContextData {
	provider: string;
	model: string;
}

// Lightweight attachment summaries persisted on a user-prompt entry so the
// conversation transcript can render chips. Neither the image bytes nor the
// file's disk path are persisted — only what the chip needs to display.
export interface StudioChatImageAttachmentSummary extends StudioChatImageAttachment {
	kind: 'image';
	// `data:` URL for rendering a thumbnail in the transcript. Persisted so the
	// preview survives a session reload (the raw bytes are not kept elsewhere).
	previewDataUrl?: string;
}

export interface StudioChatFileAttachmentSummary {
	kind: 'file';
	name: string;
	mimeType?: string;
	size?: number;
}

export type StudioChatAttachmentSummary =
	| StudioChatImageAttachmentSummary
	| StudioChatFileAttachmentSummary;

// `source` distinguishes a user-typed prompt from an `ask_user` answer the
// runtime forwarded to the model — the renderer only shows `'prompt'`.
export interface StudioUserPromptData {
	text: string;
	source: 'prompt' | 'ask_user';
	sitePath?: string;
	attachments?: StudioChatAttachmentSummary[];
}

export interface StudioCustomEntryDataMap {
	'studio.site_selected': StudioSiteSelectedData;
	'studio.tool_progress': StudioToolProgressData;
	'studio.chat_artifact': StudioChatArtifactData;
	'studio.agent_question': StudioAgentQuestionData;
	'studio.turn_closed': StudioTurnClosedData;
	'studio.session_context': StudioSessionContextData;
	'studio.user_prompt': StudioUserPromptData;
}

export type StudioCustomEntry< T extends StudioCustomEntryType = StudioCustomEntryType > = Omit<
	CustomEntry< StudioCustomEntryDataMap[ T ] >,
	'customType'
> & {
	customType: T;
};

export function isStudioCustomEntry( entry: SessionEntry ): entry is StudioCustomEntry {
	return (
		entry.type === 'custom' &&
		typeof entry.customType === 'string' &&
		entry.customType.startsWith( 'studio.' )
	);
}

export function isStudioCustomEntryOfType< T extends StudioCustomEntryType >(
	entry: SessionEntry,
	customType: T
): entry is StudioCustomEntry< T > {
	return entry.type === 'custom' && entry.customType === customType;
}
