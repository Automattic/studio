// Renderer-safe mirror of @mariozechner/pi-coding-agent's session entry types.
// Pi's own types live behind a Node-only module (sync fs); duplicating the
// shapes here lets apps/ui consume them without bundling pi.
// The CLI uses pi's own types directly and asserts compatibility via
// `satisfies` checks at the persistence boundary.

export interface PiTextContent {
	type: 'text';
	text: string;
	textSignature?: string;
}

export interface PiThinkingContent {
	type: 'thinking';
	thinking: string;
	thinkingSignature?: string;
	redacted?: boolean;
}

export interface PiImageContent {
	type: 'image';
	data: string;
	mimeType: string;
}

export interface PiToolCall {
	type: 'toolCall';
	id: string;
	name: string;
	arguments: Record< string, unknown >;
	thoughtSignature?: string;
}

export interface PiUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export type PiStopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

export interface PiUserMessage {
	role: 'user';
	content: string | ( PiTextContent | PiImageContent )[];
	timestamp: number;
}

export interface PiAssistantMessage {
	role: 'assistant';
	content: ( PiTextContent | PiThinkingContent | PiToolCall )[];
	api: string;
	provider: string;
	model: string;
	responseId?: string;
	usage: PiUsage;
	stopReason: PiStopReason;
	errorMessage?: string;
	timestamp: number;
}

export interface PiToolResultMessage {
	role: 'toolResult';
	toolCallId: string;
	toolName: string;
	content: ( PiTextContent | PiImageContent )[];
	details?: unknown;
	isError: boolean;
	timestamp: number;
}

// Pi's `Message` plus pi-coding-agent's CustomAgentMessages augmentation.
export type PiAgentMessage =
	| PiUserMessage
	| PiAssistantMessage
	| PiToolResultMessage
	| {
			role: 'bashExecution';
			command: string;
			output: string;
			timestamp: number;
			[ k: string ]: unknown;
	  }
	| {
			role: 'custom';
			customType: string;
			content: unknown;
			display: boolean;
			timestamp: number;
			[ k: string ]: unknown;
	  }
	| { role: 'branchSummary'; summary: string; fromId: string; timestamp: number }
	| { role: 'compactionSummary'; summary: string; tokensBefore: number; timestamp: number };

export interface PiSessionHeader {
	type: 'session';
	version?: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

export interface PiSessionEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface PiSessionMessageEntry extends PiSessionEntryBase {
	type: 'message';
	message: PiAgentMessage;
}

export interface PiThinkingLevelChangeEntry extends PiSessionEntryBase {
	type: 'thinking_level_change';
	thinkingLevel: string;
}

export interface PiModelChangeEntry extends PiSessionEntryBase {
	type: 'model_change';
	provider: string;
	modelId: string;
}

export interface PiCompactionEntry extends PiSessionEntryBase {
	type: 'compaction';
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: unknown;
	fromHook?: boolean;
}

export interface PiBranchSummaryEntry extends PiSessionEntryBase {
	type: 'branch_summary';
	fromId: string;
	summary: string;
	details?: unknown;
	fromHook?: boolean;
}

export interface PiCustomEntry< TData = unknown > extends PiSessionEntryBase {
	type: 'custom';
	customType: string;
	data?: TData;
}

export interface PiCustomMessageEntry< TDetails = unknown > extends PiSessionEntryBase {
	type: 'custom_message';
	customType: string;
	content: string | ( PiTextContent | PiImageContent )[];
	details?: TDetails;
	display: boolean;
}

export interface PiLabelEntry extends PiSessionEntryBase {
	type: 'label';
	targetId: string;
	label: string | undefined;
}

export interface PiSessionInfoEntry extends PiSessionEntryBase {
	type: 'session_info';
	name?: string;
}

export type PiSessionEntry =
	| PiSessionMessageEntry
	| PiThinkingLevelChangeEntry
	| PiModelChangeEntry
	| PiCompactionEntry
	| PiBranchSummaryEntry
	| PiCustomEntry
	| PiCustomMessageEntry
	| PiLabelEntry
	| PiSessionInfoEntry;

export type PiFileEntry = PiSessionHeader | PiSessionEntry;

// Studio extends pi's session schema by writing typed CustomEntry payloads.
// All studio custom entries share the `studio.` prefix on `customType` so
// readers can filter cleanly and pi's session-level operations leave them
// alone.
export const STUDIO_CUSTOM_ENTRY_PREFIX = 'studio.';

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

// `user_prompt` carries the raw text the user typed plus the source. Pi has
// `UserMessage` but it can't represent the difference between a user-typed
// prompt and an `ask_user` tool-result answer that the runtime then forwards
// to the model. We render only `source: 'prompt'` in the transcript.
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

export type StudioCustomEntry< T extends StudioCustomEntryType = StudioCustomEntryType > = Omit<
	PiCustomEntry< StudioCustomEntryDataMap[ T ] >,
	'customType'
> & {
	customType: T;
};

// Guards accept the structural minimum so callers can pass either pi's own
// `SessionEntry` (from `@mariozechner/pi-coding-agent`) or this module's
// `PiSessionEntry` mirror without a brand-mismatch error.
type EntryLike = { type?: string; customType?: string };

export function isStudioCustomEntry( entry: EntryLike ): entry is StudioCustomEntry {
	return (
		entry.type === 'custom' &&
		typeof entry.customType === 'string' &&
		entry.customType.startsWith( STUDIO_CUSTOM_ENTRY_PREFIX )
	);
}

export function isStudioCustomEntryOfType< T extends StudioCustomEntryType >(
	entry: EntryLike,
	customType: T
): entry is StudioCustomEntry< T > {
	return entry.type === 'custom' && entry.customType === customType;
}
