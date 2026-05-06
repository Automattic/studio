// Streaming-message types the runtime synthesizes and the UI / recorder /
// replay / eval consume. The shape is preserved from the original SDK so
// existing consumers don't have to change.

export interface SDKTextBlock {
	type: 'text';
	text: string;
}

export interface SDKToolUseBlock {
	type: 'tool_use';
	id: string;
	name: string;
	input: Record< string, unknown >;
}

export interface SDKToolResultBlock {
	type: 'tool_result';
	tool_use_id: string;
	content: string;
	is_error: boolean;
}

export interface SDKThinkingBlock {
	type: 'thinking';
	thinking?: string;
}

export type SDKContentBlock =
	| SDKTextBlock
	| SDKToolUseBlock
	| SDKToolResultBlock
	| SDKThinkingBlock;

export interface SDKUsage {
	input_tokens: number;
	output_tokens: number;
	cache_creation_input_tokens: number;
	cache_read_input_tokens: number;
	service_tier: string;
}

export interface SDKResultUsage extends SDKUsage {
	server_tool_use: { web_search_requests: number };
}

export interface SDKAssistantMessage {
	type: 'assistant';
	parent_tool_use_id: string | null;
	uuid: string;
	session_id: string;
	message: {
		id: string;
		type: 'message';
		role: 'assistant';
		model: string;
		content: SDKContentBlock[];
		stop_reason: string | null;
		stop_sequence: string | null;
		usage: SDKUsage;
	};
	error?: boolean;
}

export interface SDKUserMessage {
	type: 'user';
	parent_tool_use_id: string | null;
	uuid: string;
	session_id: string;
	message: {
		role: 'user';
		content: SDKContentBlock[];
	};
	// Legacy field on JSONL sessions; UI parses it defensively.
	tool_use_result?: unknown;
}

export interface SDKSystemInitMessage {
	type: 'system';
	subtype: 'init';
	apiKeySource: string;
	cwd: string;
	tools: string[];
	mcp_servers: string[];
	model: string;
	permissionMode: string;
	slash_commands: string[];
	output_style: string;
	skills: string[];
	plugins: string[];
	claude_code_version: string;
	uuid: string;
	session_id: string;
}

export interface SDKSystemStatusMessage {
	type: 'system';
	subtype: 'status';
	status: string;
	uuid: string;
	session_id: string;
}

export interface SDKSystemCompactBoundaryMessage {
	type: 'system';
	subtype: 'compact_boundary';
	uuid: string;
	session_id: string;
}

export type SDKSystemMessage =
	| SDKSystemInitMessage
	| SDKSystemStatusMessage
	| SDKSystemCompactBoundaryMessage;

export interface SDKResultMessage {
	type: 'result';
	subtype: 'success' | 'error_during_execution';
	duration_ms: number;
	duration_api_ms: number;
	is_error: boolean;
	num_turns: number;
	result: string;
	stop_reason: string | null;
	total_cost_usd: number;
	usage: SDKResultUsage;
	modelUsage: Record< string, unknown >;
	permission_denials: Array< { tool_name: string } >;
	errors?: string[];
	uuid: string;
	session_id: string;
}

export type SDKMessage = SDKAssistantMessage | SDKUserMessage | SDKSystemMessage | SDKResultMessage;

export interface TodoWriteInput {
	todos: Array< {
		content: string;
		activeForm: string;
		status: 'pending' | 'in_progress' | 'completed';
	} >;
}
