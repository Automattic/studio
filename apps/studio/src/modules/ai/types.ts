export type TaskStatus = 'in-progress' | 'waiting' | 'done';

export interface TaskMetadata {
	id: string;
	siteId: string;
	title: string;
	summary?: string;
	status: TaskStatus;
	archived: boolean;
	createdAt: number;
	updatedAt: number;
	/** Claude Agent SDK session ID, used for resuming conversations */
	sessionId?: string;
}

export interface ImageAttachment {
	/** Base64-encoded image data (no data-URI prefix) */
	data: string;
	/** MIME type, e.g. 'image/png', 'image/jpeg', 'image/webp', 'image/gif' */
	mediaType: string;
}

export interface ElementAttachment {
	/** Unique CSS selector path for the element */
	cssSelector: string;
	/** HTML tag name (lowercase) */
	tagName: string;
	/** Truncated outer HTML of the element */
	outerHTML: string;
	/** Truncated text content */
	textContent: string;
	/** Key computed CSS properties */
	computedStyles: Record< string, string >;
	/** Element bounding box */
	boundingBox: { x: number; y: number; width: number; height: number };
	/** DOM ancestor path, e.g. ["body", "div.site", "main", "h1"] */
	domPath: string[];
	/** WordPress block name if element is inside a block, e.g. "core/button" */
	wpBlockName?: string;
}

export interface TaskMessage {
	id: string;
	role: 'user' | 'assistant' | 'tool' | 'system';
	content: string;
	timestamp: number;
	images?: ImageAttachment[];
	elements?: ElementAttachment[];
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
