// Main module exports
export {
	startAgentServer,
	stopAgentServer,
	getAgentServerPort,
	isAgentServerRunning,
} from './lib/agent-server';

export {
	saveApiKey,
	getApiKey,
	hasApiKey,
	removeApiKey,
	validateApiKeyFormat,
} from './lib/api-key-storage';

export { processChat, validateApiKey } from './lib/anthropic-client';

export { executeTool, getToolDefinitions, hasToolByName } from './lib/tool-executor';

export { tools } from './lib/tools';

// Type exports
export type {
	AgentMessage,
	AgentStatus,
	ChatRequest,
	ToolCall,
	ToolDefinition,
	ToolResult,
	ToolResultMessage,
	ServerEvent,
	ServerEventType,
	WpCliValidationResult,
} from './types';
