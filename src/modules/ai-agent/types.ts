import Anthropic from '@anthropic-ai/sdk';

// Tool-related types
export interface ToolDefinition {
	name: string;
	description: string;
	input_schema: Anthropic.Tool[ 'input_schema' ];
}

export interface ToolResult {
	success: boolean;
	output?: string;
	error?: string;
}

// Chat message types for agent
export interface AgentMessage {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	createdAt: number;
	toolCalls?: ToolCall[];
	toolResults?: ToolResultMessage[];
	isStreaming?: boolean;
}

export interface ToolCall {
	id: string;
	name: string;
	input: Record< string, unknown >;
}

export interface ToolResultMessage {
	toolCallId: string;
	toolName: string;
	result: ToolResult;
	executedAt: number;
}

// API request/response types
export interface ChatRequest {
	message: string;
	siteId: string;
	instanceId: string;
}

export interface AgentStatus {
	isConfigured: boolean;
	serverPort: number | null;
}

// Server event types for SSE
export type ServerEventType =
	| 'message_start'
	| 'content_block_start'
	| 'content_delta'
	| 'content_block_stop'
	| 'content_done'
	| 'tool_use_start'
	| 'tool_use_done'
	| 'tool_result'
	| 'message_done'
	| 'error';

export interface ServerEvent {
	type: ServerEventType;
	data: unknown;
}

export interface ContentBlockStartEvent {
	type: 'content_block_start';
	data: {
		index: number;
		blockType: 'text' | 'tool_use';
		id?: string;
		name?: string;
	};
}

export interface ContentDeltaEvent {
	type: 'content_delta';
	data: {
		index: number;
		text: string;
	};
}

export interface ContentBlockStopEvent {
	type: 'content_block_stop';
	data: {
		index: number;
		blockType: 'text' | 'tool_use';
		id?: string;
		name?: string;
		input?: Record< string, unknown >;
	};
}

export interface ToolUseStartEvent {
	type: 'tool_use_start';
	data: {
		id: string;
		name: string;
		input: Record< string, unknown >;
	};
}

export interface ToolResultEvent {
	type: 'tool_result';
	data: {
		toolCallId: string;
		toolName: string;
		result: ToolResult;
	};
}

export interface MessageDoneEvent {
	type: 'message_done';
	data: {
		messageId: string;
	};
}

export interface ErrorEvent {
	type: 'error';
	data: {
		message: string;
		code?: string;
	};
}

// WP-CLI safety types
export interface WpCliValidationResult {
	isAllowed: boolean;
	requiresConfirmation: boolean;
	warningMessage?: string;
	blockedReason?: string;
}

// Frontend display types (for Redux/UI)
export interface ToolCallDisplay {
	id: string;
	name: string;
	input: Record< string, unknown >;
	result?: ToolResult;
	executedAt?: number;
}

// Content block types for interleaved text and tool calls
export interface TextBlock {
	type: 'text';
	text: string;
}

export interface ToolCallBlock {
	type: 'tool_call';
	toolCall: ToolCallDisplay;
}

export type ContentBlock = TextBlock | ToolCallBlock;

export interface AgentMessageDisplay {
	id: string;
	role: 'user' | 'assistant';
	content: string; // Keep for backwards compat / simple display
	contentBlocks?: ContentBlock[]; // For interleaved rendering
	createdAt: number;
	toolCalls?: ToolCallDisplay[]; // Keep for backwards compat
	isStreaming?: boolean;
	error?: string;
}
