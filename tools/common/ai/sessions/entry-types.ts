// Studio metadata rides as `studio.*` `customType` entries on top of pi's
// `SessionEntry` schema. Renderer-safe (no pi imports) — CLI code imports
// `SessionEntry` from `@mariozechner/pi-coding-agent` directly.

export interface SessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
	customType?: string;
}

export type StudioCustomEntryType =
	| 'studio.site_selected'
	| 'studio.tool_progress'
	| 'studio.agent_question'
	| 'studio.turn_closed'
	| 'studio.session_cleared'
	| 'studio.session_context'
	| 'studio.session_linked'
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
}

export type StudioTurnStatus = 'success' | 'error' | 'max_turns' | 'interrupted';

export interface StudioTurnClosedData {
	status: StudioTurnStatus;
}

export interface StudioSessionContextData {
	provider: string;
	model: string;
}

export interface StudioSessionLinkedData {
	agentSessionId: string;
}

// `source` distinguishes a user-typed prompt from an `ask_user` answer the
// runtime forwarded to the model — the renderer only shows `'prompt'`.
export interface StudioUserPromptData {
	text: string;
	source: 'prompt' | 'ask_user';
	sitePath?: string;
}

export interface StudioCustomEntryDataMap {
	'studio.site_selected': StudioSiteSelectedData;
	'studio.tool_progress': StudioToolProgressData;
	'studio.agent_question': StudioAgentQuestionData;
	'studio.turn_closed': StudioTurnClosedData;
	'studio.session_cleared': Record< string, never >;
	'studio.session_context': StudioSessionContextData;
	'studio.session_linked': StudioSessionLinkedData;
	'studio.user_prompt': StudioUserPromptData;
}

export interface StudioCustomEntry< T extends StudioCustomEntryType = StudioCustomEntryType >
	extends SessionEntryBase {
	type: 'custom';
	customType: T;
	data?: StudioCustomEntryDataMap[ T ];
}

type EntryShape = { type?: unknown; customType?: unknown };

export function isStudioCustomEntry( entry: EntryShape ): entry is StudioCustomEntry {
	return (
		entry.type === 'custom' &&
		typeof entry.customType === 'string' &&
		entry.customType.startsWith( 'studio.' )
	);
}

export function isStudioCustomEntryOfType< T extends StudioCustomEntryType >(
	entry: EntryShape,
	customType: T
): entry is StudioCustomEntry< T > {
	return entry.type === 'custom' && entry.customType === customType;
}
