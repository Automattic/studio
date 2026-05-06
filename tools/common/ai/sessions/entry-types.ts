// Studio's custom-entry layer over pi-coding-agent's `SessionEntry` schema.
// All Studio metadata (site selection, paused turns, progress, agent
// questions, etc.) rides as a `custom` entry whose `customType` starts with
// `studio.`. Pi's session-level operations (compaction, summarization,
// branching) leave them alone.
//
// CLI code should import `SessionEntry` from `@mariozechner/pi-coding-agent`
// directly. This module stays free of pi imports so it can be consumed by
// `apps/ui` (the renderer) without taking a transitive bundling dependency
// on pi's Node-only modules.

// Structural minimum every pi `SessionEntry` satisfies. Used by callers
// that need to discriminate `type` / `customType` without pulling in pi's
// full type tree.
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

// `user_prompt` carries the raw text the user typed plus the source. Pi's
// `UserMessage` can't represent the difference between a user-typed prompt
// and an `ask_user` tool-result answer that the runtime forwards to the
// model. We render only `source: 'prompt'` in the transcript.
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

// Guards intentionally accept the structural minimum (`{ type, customType? }`)
// so callers can pass either pi's `SessionEntry` discriminated union or any
// SessionEntryBase-compatible object without a brand-mismatch error.
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
