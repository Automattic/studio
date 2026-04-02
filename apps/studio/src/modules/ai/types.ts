export type TaskStatus = 'in-progress' | 'waiting' | 'done';

export interface TaskMetadata {
	id: string;
	siteId: string;
	title: string;
	status: TaskStatus;
	archived: boolean;
	createdAt: number;
	updatedAt: number;
	/** Claude Agent SDK session ID, used for resuming conversations */
	sessionId?: string;
}

export interface TaskMessage {
	id: string;
	role: 'user' | 'assistant' | 'tool' | 'system';
	content: string;
	timestamp: number;
	toolName?: string;
	toolInput?: unknown;
	toolResult?: string;
	isStreaming?: boolean;
	isError?: boolean;
}

export interface PermissionRequest {
	requestId: string;
	taskId: string;
	toolName: string;
	input: unknown;
	description: string;
}

export type PermissionResponse = 'allow_once' | 'allow_session' | 'deny';
