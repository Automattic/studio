import type { SendMessageParams } from '@automattic/agenttic-client';
import type { UploadedImage } from '@automattic/agenttic-ui';
import type { SyncSite } from '@studio/common/types/sync';
import type { RemoteTargetId } from 'src/modules/workspaces/types';
import type { Message as MessageType } from 'src/stores/chat-slice';

export const WORKSPACE_DOLLY_AGENT_ID = 'dolly';
export const WORKSPACE_DOLLY_AGENT_URL_ORIGIN = 'https://public-api.wordpress.com/wpcom/v2';
export const WORKSPACE_DOLLY_MEDIA_UPLOAD_URL_ORIGIN = 'https://public-api.wordpress.com/rest/v1.1';
export const WORKSPACE_DOLLY_HISTORY_BOT_ID = 'wpcom-agent-dolly';
export const WORKSPACE_DOLLY_HISTORY_CLIENT = 'wpworkspace';
export const WORKSPACE_DOLLY_PREVIEW_TOOL_ID = 'wpworkspace/preview';
export const WORKSPACE_DOLLY_REFRESH_PREVIEW_TOOL_ID = 'wpworkspace/refresh_preview';
export const WORKSPACE_DOLLY_FRONTEND_ABILITIES = [
	WORKSPACE_DOLLY_PREVIEW_TOOL_ID,
	WORKSPACE_DOLLY_REFRESH_PREVIEW_TOOL_ID,
];
export const WORKSPACE_DOLLY_REQUEST_TIMEOUT_MS = 90_000;
export const WORKSPACE_DOLLY_HISTORY_SUMMARY_ITEMS_PER_PAGE = 20;
export const WORKSPACE_DOLLY_HISTORY_CHAT_ITEMS_PER_PAGE = 100;
export const WORKSPACE_DOLLY_HISTORY_MAX_PAGES = 10;
export const WORKSPACE_DOLLY_IMAGE_FILE_TYPES = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
];
export const WORKSPACE_DOLLY_IMAGE_MAX_FILE_SIZE = 10 * 1024 * 1024;
export const WORKSPACE_DOLLY_IMAGE_MAX_FILES = 4;
export const WORKSPACE_DOLLY_MEDIA_RETRY_DELAYS_MS = [ 1500, 4000 ];
export const WORKSPACE_DOLLY_IMAGE_PRELOAD_TIMEOUT_MS = 750;

export type WorkspaceDollyConversationKey = {
	workspaceId: string;
	targetId: RemoteTargetId;
	siteId: number;
	agentId: typeof WORKSPACE_DOLLY_AGENT_ID;
};

export type WorkspaceDollyConversationState = {
	id: string;
	key: WorkspaceDollyConversationKey;
	remoteChatId?: number;
	serverHydrationDisabled?: boolean;
	input: string;
	messages: MessageType[];
	sessionId?: string;
	lastUpdated: number;
};

export type WorkspaceDollyTargetActivity = {
	isAssistantThinking?: boolean;
	hasUnreadAssistantMessage?: boolean;
};

export type WorkspaceDollyAgentResponse = {
	text: string;
	sessionId?: string;
	selectedSiteId?: number;
};

export type WorkspaceDollyPendingImage = UploadedImage & {
	file: File;
	dataUrl?: string;
};

export type WorkspaceDollyVisibleImage = {
	name: string;
	url: string;
};

export type WorkspaceDollyMessageImageAttachment = {
	text: string;
	images: WorkspaceDollyVisibleImage[];
};

export type WorkspaceDollyUploadedImage = {
	id: number;
	url: string;
	name: string;
	mimeType: string;
	fileName?: string;
	title?: string;
};

export type WorkspaceDollyAgentImageUrl = NonNullable< SendMessageParams[ 'imageUrls' ] >[ number ];

export type WorkspaceDollyHistoryMessage = {
	content: string;
	role: 'user' | 'assistant';
	createdAt: number;
	messageApiId?: number;
};

export type WorkspaceDollyHistorySummary = {
	chatId: number;
	sessionId?: string;
	siteId?: number;
	createdAt?: number;
	firstMessage?: Record< string, unknown >;
	lastMessage?: Record< string, unknown >;
};

export type WorkspaceDollyHistoryChat = {
	chatId: number;
	sessionId?: string;
	siteId?: number;
	createdAt?: number;
	messages: WorkspaceDollyHistoryMessage[];
};

export type WorkspaceDollyPreviewContext = {
	isOpen: boolean;
	siteId: number;
	openedURL?: string;
	currentURL?: string;
	isLoading: boolean;
};

export type WorkspaceDollySiteAssociationContext = {
	status: 'workspace_target';
	workspaceId: string;
	targetId: RemoteTargetId;
	wpcomSiteId: number;
	wpcomSiteUrl: string;
	instructions: string;
};

export type WorkspaceDollyTargetDescriptor = {
	workspaceId: string;
	targetId: RemoteTargetId;
	site: SyncSite;
};
