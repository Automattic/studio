import type { SendMessageParams } from '@automattic/agenttic-client';
import type { UploadedImage } from '@automattic/agenttic-ui';
import type { SyncSite } from '@studio/common/types/sync';
import type { Message as MessageType } from 'src/stores/chat-slice';

export const DOLLY_AGENT_ID = 'dolly';
export const DOLLY_AGENT_URL_ORIGIN = 'https://public-api.wordpress.com/wpcom/v2';
export const DOLLY_MEDIA_UPLOAD_URL_ORIGIN = 'https://public-api.wordpress.com/rest/v1.1';
export const DOLLY_HISTORY_CLIENT = 'wpworkspace';
export const DOLLY_HISTORY_BOT_ID = 'wpcom-agent-dolly';
export const DOLLY_PREVIEW_TOOL_ID = 'wpworkspace/preview';
export const DOLLY_REFRESH_PREVIEW_TOOL_ID = 'wpworkspace/refresh_preview';
export const DOLLY_MANAGE_STAGING_SITE_TOOL_ID = 'wpworkspace/manage_staging_site';
export const DOLLY_FRONTEND_ABILITIES = [
	DOLLY_PREVIEW_TOOL_ID,
	DOLLY_REFRESH_PREVIEW_TOOL_ID,
	DOLLY_MANAGE_STAGING_SITE_TOOL_ID,
];
export const DOLLY_REQUEST_TIMEOUT_MS = 90_000;
export const DOLLY_HISTORY_SUMMARY_ITEMS_PER_PAGE = 20;
export const DOLLY_HISTORY_CHAT_ITEMS_PER_PAGE = 100;
export const DOLLY_HISTORY_MAX_PAGES = 10;
export const DOLLY_IMAGE_FILE_TYPES = [ 'image/jpeg', 'image/png', 'image/gif', 'image/webp' ];
export const DOLLY_IMAGE_MAX_FILE_SIZE = 10 * 1024 * 1024;
export const DOLLY_IMAGE_MAX_FILES = 4;
export const DOLLY_MEDIA_RETRY_DELAYS_MS = [ 1500, 4000 ];
export const DOLLY_IMAGE_PRELOAD_TIMEOUT_MS = 750;

export type DollySite = {
	id: number;
	name: string;
	url?: string;
	slug?: string;
};

export type DollyAgentResponse = {
	text: string;
	sessionId?: string;
	selectedSiteId?: number;
};

export type DollyPendingImage = UploadedImage & {
	file: File;
	dataUrl?: string;
};

export type DollyVisibleImage = {
	name: string;
	url: string;
};

export type DollyMessageImageAttachment = {
	text: string;
	images: DollyVisibleImage[];
};

export type DollyUploadedImage = {
	id: number;
	url: string;
	name: string;
	mimeType: string;
	fileName?: string;
	title?: string;
};

export type DollyAgentImageUrl = NonNullable< SendMessageParams[ 'imageUrls' ] >[ number ];

export type OpenPreviewOptions = {
	forceReload?: boolean;
};

export type DollyPreviewState = {
	open: boolean;
	pathOrUrl: string;
	title?: string;
	currentUrl?: string;
	pageTitle?: string;
	canGoBack?: boolean;
	canGoForward?: boolean;
	isLoading: boolean;
	reloadNonce: number;
	navigationAction?: 'back' | 'forward';
	navigationNonce?: number;
};

export type DollyPreviewAbilityContext = {
	activeWpcomSite: SyncSite;
	previewState: DollyPreviewState;
	openPreview: ( pathOrUrl?: string, title?: string, options?: OpenPreviewOptions ) => void;
};

export type WpcomSiteAssistantConversationKey = {
	siteId: number;
	agentId: string;
};

export type WpcomSiteAssistantSessionState = {
	id: string;
	key: WpcomSiteAssistantConversationKey;
	remoteChatId?: number;
	serverHydrationDisabled?: boolean;
	input: string;
	messages: MessageType[];
	sessionId?: string;
	activeWpcomSite: SyncSite;
	previewState: DollyPreviewState;
	lastUpdated: number;
};

export type DollyHistoryMessage = {
	content: string;
	role: 'user' | 'assistant';
	createdAt: number;
	messageApiId?: number;
};

export type DollyHistorySummary = {
	chatId: number;
	sessionId?: string;
	siteId?: number;
	createdAt?: number;
	firstMessage?: Record< string, unknown >;
	lastMessage?: Record< string, unknown >;
};

export type DollyHistoryChat = {
	chatId: number;
	sessionId?: string;
	siteId?: number;
	createdAt?: number;
	messages: DollyHistoryMessage[];
};

export type DollyPreviewContext = {
	isOpen: boolean;
	siteId: number;
	openedURL?: string;
	currentURL?: string;
	title?: string;
	isLoading: boolean;
};

export type DollySiteAssociationContext = {
	status: 'wpcom_only';
	wpcomSiteId: number;
	wpcomSiteUrl: string;
	instructions: string;
};
