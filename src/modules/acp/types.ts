/**
 * Agent Client Protocol (ACP) Type Definitions
 *
 * ACP is a JSON-RPC 2.0 based protocol for communicating with AI coding agents.
 * This module defines types for managing ACP agents in WordPress Studio.
 */

// Agent provider types
export type AgentProvider = 'wpcom' | 'anthropic-builtin' | 'acp';

// Status of an individual agent
export type AgentStatus = 'available' | 'unavailable' | 'running' | 'error';

/**
 * Configuration for an agent available in WordPress Studio.
 */
export interface AgentConfig {
	/** Unique identifier for the agent */
	id: string;
	/** Display name */
	name: string;
	/** Description shown in tooltips */
	description: string;
	/** Provider type */
	provider: AgentProvider;
	/** SVG icon as string or URL (optional) */
	icon?: string;
	/** Command to run for ACP agents */
	command?: string;
	/** Arguments to pass to the command */
	args?: string[];
	/** Environment variables to set when running the command */
	env?: Record< string, string >;
	/** Environment variable for API key (if needed) */
	apiKeyEnvVar?: string;
	/** Whether this agent is detected/installed on the system */
	isInstalled?: boolean;
	/** Current status */
	status?: AgentStatus;
	/** Whether this agent requires a TTY for stdin/stdout */
	requiresTty?: boolean;
}

/**
 * Model info from ACP agent.
 */
export interface AcpModelInfo {
	/** Unique model identifier */
	modelId: string;
	/** Display name */
	name: string;
	/** Description (optional) */
	description?: string;
}

/**
 * Model state for an ACP session.
 */
export interface AcpModelState {
	/** Available models */
	availableModels: AcpModelInfo[];
	/** Currently selected model ID */
	currentModelId: string;
}

/**
 * ACP Session state.
 */
export interface AcpSession {
	/** Unique session ID (internal) */
	id: string;
	/** Session ID from ACP agent (returned by session/new) */
	acpSessionId?: string;
	/** Agent config being used */
	agentId: string;
	/** Site ID this session is for */
	siteId: string;
	/** Process ID of the running agent */
	pid?: number;
	/** Session state */
	state: 'starting' | 'ready' | 'closed' | 'error';
	/** Error message if state is 'error' */
	error?: string;
	/** Created timestamp */
	createdAt: number;
	/** Available models (if agent supports model selection) */
	models?: AcpModelState;
}

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

export interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: string | number;
	method: string;
	params?: Record< string, unknown >;
}

export interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: string | number | null;
	result?: unknown;
	error?: JsonRpcError;
}

export interface JsonRpcNotification {
	jsonrpc: '2.0';
	method: string;
	params?: Record< string, unknown >;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

// ============================================================================
// ACP Protocol Types (Based on ACP Spec)
// ============================================================================

/**
 * ACP session/start request parameters.
 */
export interface AcpSessionStartParams {
	/** Client information */
	client_info?: {
		name: string;
		version: string;
	};
	/** Working directory for the agent */
	working_directory?: string;
	/** Initial context/instructions */
	context?: string;
}

/**
 * ACP session/new response.
 */
export interface AcpSessionStartResult {
	/** Session ID (from ACP agent) */
	sessionId: string;
	/** Session modes if available */
	modes?: {
		available: string[];
		current: string;
	} | null;
}

/**
 * ACP prompt/start request parameters.
 */
export interface AcpPromptStartParams {
	/** The user's prompt */
	prompt: string;
	/** Optional conversation context */
	context?: {
		/** Previous messages */
		messages?: AcpMessage[];
	};
}

/**
 * ACP prompt/start response.
 */
export interface AcpPromptStartResult {
	/** Prompt ID */
	prompt_id: string;
}

/**
 * ACP message structure.
 */
export interface AcpMessage {
	role: 'user' | 'assistant';
	content: string;
}

/**
 * ACP session/update notification parameters.
 * Sent by agent to stream content updates.
 */
export interface AcpSessionUpdateParams {
	/** Type of update */
	type:
		| 'text'
		| 'tool_use'
		| 'tool_result'
		| 'thinking'
		| 'progress'
		| 'approval_request'
		| 'done'
		| 'error';
	/** Text content (for 'text' type) */
	text?: string;
	/** Tool use details (for 'tool_use' type) */
	tool_use?: {
		id: string;
		name: string;
		input: Record< string, unknown >;
	};
	/** Tool result (for 'tool_result' type) */
	tool_result?: {
		tool_use_id: string;
		output?: string;
		error?: string;
	};
	/** Thinking content (for 'thinking' type) */
	thinking?: string;
	/** Progress info (for 'progress' type) */
	progress?: {
		message: string;
		percentage?: number;
	};
	/** Approval request (for 'approval_request' type) */
	approval_request?: {
		id: string;
		message: string;
		options: string[];
	};
	/** Error details (for 'error' type) */
	error?: {
		code: string;
		message: string;
	};
}

// ============================================================================
// ACP Callback Types
// ============================================================================

/**
 * File system read callback parameters.
 */
export interface AcpFsReadParams {
	path: string;
}

/**
 * File system write callback parameters.
 */
export interface AcpFsWriteParams {
	path: string;
	content: string;
}

/**
 * File system list callback parameters.
 */
export interface AcpFsListParams {
	path: string;
	recursive?: boolean;
}

/**
 * Terminal execute callback parameters.
 */
export interface AcpTerminalExecParams {
	command: string;
	cwd?: string;
}

// ============================================================================
// Redux State Types
// ============================================================================

/**
 * Agent chat state for Redux store.
 */
export interface AgentChatStateV2 {
	/** Currently selected agent ID */
	selectedAgentId: string;
	/** Available agents (both built-in and detected) */
	availableAgents: AgentConfig[];
	/** Agent status by ID */
	agentStatusDict: Record< string, AgentStatus >;
	/** Active ACP sessions */
	acpSessions: Record< string, AcpSession >;
	/** Messages by instance ID */
	messagesDict: Record< string, AgentMessageV2[] >;
	/** Loading state by instance ID */
	isLoadingDict: Record< string, boolean >;
	/** Streaming state by instance ID */
	isStreamingDict: Record< string, boolean >;
	/** Agent server port (for built-in Anthropic agent) */
	agentServerPort: number | null;
	/** Whether built-in agent is configured */
	isConfigured: boolean;
	/** Chat input by site ID */
	chatInputBySite: Record< string, string >;
}

/**
 * Agent message structure for v2.
 */
export interface AgentMessageV2 {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	createdAt: number;
	/** Tool calls in this message */
	toolCalls?: ToolCallV2[];
	/** Whether the message is still streaming */
	isStreaming?: boolean;
	/** Error if message failed */
	error?: string;
	/** Agent ID that generated this message */
	agentId?: string;
}

export interface ToolCallV2 {
	id: string;
	name: string;
	input: Record< string, unknown >;
	result?: {
		success: boolean;
		output?: string;
		error?: string;
	};
	executedAt?: number;
}
