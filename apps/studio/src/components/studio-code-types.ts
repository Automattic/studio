export type ToolCallState = {
	id: string;
	name: string;
	input: Record< string, unknown >;
	status: 'running' | 'completed' | 'error';
	output?: string;
	isError?: boolean;
};

export type ChatMessage = {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	toolCalls: ToolCallState[];
	timestamp: number;
};

export type PermissionRequest = {
	id: string;
	toolName: string;
	input: Record< string, unknown >;
	description: string;
};
