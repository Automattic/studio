/**
 * Serializable agent message types for IPC between CLI child process and Electron main/renderer.
 * These mirror the relevant parts of SDKMessage from @anthropic-ai/claude-agent-sdk
 * so the renderer can understand agent messages without importing the SDK.
 */

export interface AgentTextBlock {
	type: 'text';
	text: string;
}

export interface AgentToolUseBlock {
	type: 'tool_use';
	id: string;
	name: string;
	input: Record< string, unknown >;
}

export interface AgentAssistantMessage {
	type: 'assistant';
	message: {
		content: Array< AgentTextBlock | AgentToolUseBlock >;
	};
}

export interface AgentToolResultContent {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
}

export interface AgentToolResultMessage {
	type: 'user';
	tool_use_result?: {
		content?: AgentToolResultContent[];
		isError?: boolean;
	};
}

export interface AgentResultMessage {
	type: 'result';
	subtype: string;
	session_id: string;
	num_turns: number;
	total_cost_usd: number;
	errors?: string[];
	permission_denials?: Array< { tool_name: string } >;
}

export type SerializedAgentMessage =
	| AgentAssistantMessage
	| AgentToolResultMessage
	| AgentResultMessage;

/**
 * IPC messages from parent (Electron main) to child (CLI ai --pipe).
 */
export interface AgentPromptMessage {
	type: 'prompt';
	prompt: string;
	model?: string;
	resume?: string;
	siteContext?: {
		name: string;
		path: string;
		running: boolean;
	};
}

export interface AgentAskUserResponseMessage {
	type: 'ask-user-response';
	answers: Record< string, string >;
}

export interface AgentInterruptMessage {
	type: 'interrupt';
}

export type ParentToChildMessage =
	| AgentPromptMessage
	| AgentAskUserResponseMessage
	| AgentInterruptMessage;

/**
 * IPC messages from child (CLI ai --pipe) to parent (Electron main).
 */
export interface ChildAgentMessageEvent {
	type: 'agent-message';
	message: SerializedAgentMessage;
}

export interface ChildAskUserEvent {
	type: 'ask-user';
	questions: Array< {
		question: string;
		options: Array< { label: string; description: string } >;
	} >;
}

export interface ChildReadyEvent {
	type: 'ready';
}

export interface ChildErrorEvent {
	type: 'error';
	message: string;
}

export type ChildToParentMessage =
	| ChildAgentMessageEvent
	| ChildAskUserEvent
	| ChildReadyEvent
	| ChildErrorEvent;

/**
 * Tool display names and detail extraction for rendering in the UI.
 */
export const TOOL_DISPLAY_NAMES: Record< string, string > = {
	mcp__studio__site_create: 'Create site',
	mcp__studio__site_list: 'List sites',
	mcp__studio__site_info: 'Get site info',
	mcp__studio__site_start: 'Start site',
	mcp__studio__site_stop: 'Stop site',
	mcp__studio__site_delete: 'Delete site',
	mcp__studio__wp_cli: 'Run WP-CLI',
	mcp__studio__validate_blocks: 'Validate blocks',
	mcp__studio__take_screenshot: 'Take screenshot',
	Read: 'Read',
	Write: 'Write',
	Edit: 'Edit',
	Bash: 'Run',
	Glob: 'Search',
	Grep: 'Search',
};

export function getToolDisplayName( name: string ): string {
	return TOOL_DISPLAY_NAMES[ name ] ?? name;
}

export function getToolDetail( name: string, input: Record< string, unknown > ): string {
	switch ( name ) {
		case 'mcp__studio__site_create':
			return typeof input.name === 'string' ? input.name : '';
		case 'mcp__studio__site_info':
		case 'mcp__studio__site_start':
		case 'mcp__studio__site_stop':
		case 'mcp__studio__site_delete':
			return typeof input.nameOrPath === 'string' ? input.nameOrPath : '';
		case 'mcp__studio__wp_cli':
			return typeof input.command === 'string' ? `wp ${ input.command }` : '';
		case 'mcp__studio__validate_blocks':
			if ( typeof input.filePath === 'string' ) {
				return input.filePath.split( '/' ).slice( -2 ).join( '/' );
			}
			return 'inline content';
		case 'mcp__studio__take_screenshot':
			return typeof input.url === 'string' ? input.url : '';
		case 'Read':
		case 'Write':
		case 'Edit': {
			const filePath = input.file_path ?? input.path;
			if ( typeof filePath === 'string' ) {
				return filePath.split( '/' ).slice( -2 ).join( '/' );
			}
			return '';
		}
		case 'Bash':
			return typeof input.command === 'string'
				? input.command.length > 60
					? input.command.slice( 0, 57 ) + '…'
					: input.command
				: '';
		case 'Grep':
		case 'Glob':
			return typeof input.pattern === 'string' ? input.pattern : '';
		default:
			return '';
	}
}
