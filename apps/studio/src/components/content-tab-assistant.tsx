import {
	createClient,
	createTextMessage,
	extractTextFromMessage,
	useClientAbilities,
	type Ability,
	type ContextProvider,
	type FilePart,
	type TaskUpdate,
	type ToolProvider,
} from '@automattic/agenttic-client';
import { AgentUI, ImageUploader } from '@automattic/agenttic-ui';
import {
	__unstableAnimatePresence as AnimatePresence,
	__unstableMotion as motion,
} from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	closeSmall,
	desktop,
	external,
	Icon,
	image as imageIcon,
	redo,
	trash,
} from '@wordpress/icons';
import { useI18n } from '@wordpress/react-i18n';
import React, { useState, useEffect, useRef, memo, useCallback, useMemo, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import ClearHistoryReminder from 'src/components/ai-clear-history-reminder';
import { AIInput } from 'src/components/ai-input';
import { ArrowIcon } from 'src/components/arrow-icon';
import { MessageThinking } from 'src/components/assistant-thinking';
import Button from 'src/components/button';
import { ChatMessage, MarkDownWithCode } from 'src/components/chat-message';
import { ChatRating } from 'src/components/chat-rating';
import { LearnMoreLink } from 'src/components/learn-more';
import offlineIcon from 'src/components/offline-icon';
import { StudioCodeChat } from 'src/components/studio-code-chat';
import WelcomeComponent from 'src/components/welcome-message-prompt';
import {
	LIMIT_OF_PROMPTS_PER_USER,
	LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY,
	TELEX_HOSTNAME,
	TELEX_UTM_PARAMS,
} from 'src/constants';
import { useAuth } from 'src/hooks/use-auth';
import { useFeatureFlags } from 'src/hooks/use-feature-flags';
import { useOffline } from 'src/hooks/use-offline';
import { useThemeDetails } from 'src/hooks/use-theme-details';
import { cx } from 'src/lib/cx';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { addUrlParams } from 'src/lib/url-utils';
import { useAppDispatch, useRootSelector } from 'src/stores';
import {
	chatThunks,
	generateMessage,
	Message as MessageType,
	chatActions,
	chatSelectors,
} from 'src/stores/chat-slice';
import { useGetAssistantQuota, useGetWelcomeMessages } from 'src/stores/wpcom-api';
import type {
	AgentUIProps,
	ImageUploaderHandle,
	MessageAction,
	NoticeConfig as AgentticNoticeConfig,
	UploadedImage,
} from '@automattic/agenttic-ui';
import type { SyncSite } from '@studio/common/types/sync';
import type { WPCOM } from 'wpcom/types';

export const MIMIC_CONVERSATION_DELAY = 500;
const DOLLY_AGENT_ID = 'dolly';
const DOLLY_AGENT_URL_ORIGIN = 'https://public-api.wordpress.com/wpcom/v2';
const DOLLY_MEDIA_UPLOAD_URL_ORIGIN = 'https://public-api.wordpress.com/rest/v1.1';
const DOLLY_HISTORY_CLIENT = 'wpworkspace';
const DOLLY_HISTORY_BOT_ID = 'wpcom-agent-dolly';
const DOLLY_PREVIEW_TOOL_ID = 'wpworkspace/preview';
const DOLLY_REFRESH_PREVIEW_TOOL_ID = 'wpworkspace/refresh_preview';
const DOLLY_FRONTEND_ABILITIES = [ DOLLY_PREVIEW_TOOL_ID, DOLLY_REFRESH_PREVIEW_TOOL_ID ];
const DOLLY_PREVIEW_PANEL_DEFAULT_WIDTH = 520;
const DOLLY_PREVIEW_PANEL_MIN_WIDTH = 360;
const DOLLY_PREVIEW_PANEL_MAX_WIDTH = 820;
const DOLLY_REQUEST_TIMEOUT_MS = 90_000;
const DOLLY_HISTORY_SUMMARY_ITEMS_PER_PAGE = 20;
const DOLLY_HISTORY_CHAT_ITEMS_PER_PAGE = 100;
const DOLLY_HISTORY_MAX_PAGES = 10;
const DOLLY_IMAGE_FILE_TYPES = [ 'image/jpeg', 'image/png', 'image/gif', 'image/webp' ];
const DOLLY_IMAGE_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DOLLY_IMAGE_MAX_FILES = 4;
const DOLLY_MEDIA_RETRY_DELAYS_MS = [ 1500, 4000 ];
const DOLLY_IMAGE_PRELOAD_TIMEOUT_MS = 750;

type DollySite = {
	id: number;
	name: string;
	url?: string;
	slug?: string;
};

type DollyAgentResponse = {
	text: string;
	sessionId?: string;
	selectedSiteId?: number;
};

type DollyPendingImage = UploadedImage & {
	file: File;
	dataUrl?: string;
};

type DollyVisibleImage = {
	name: string;
	url: string;
};

type DollyMessageImageAttachment = {
	text: string;
	images: DollyVisibleImage[];
};

type DollyUploadedImage = {
	id: number;
	url: string;
	name: string;
	mimeType: string;
	fileName?: string;
	title?: string;
};

type OpenPreviewOptions = {
	forceReload?: boolean;
};

type DollyPreviewState = {
	open: boolean;
	pathOrUrl: string;
	title?: string;
	currentUrl?: string;
	pageTitle?: string;
	isLoading: boolean;
	reloadNonce: number;
};

type DollyPreviewAbilityContext = {
	activeWpcomSite: SyncSite;
	previewState: DollyPreviewState;
	openPreview: ( pathOrUrl?: string, title?: string, options?: OpenPreviewOptions ) => void;
};

type WpcomSiteAssistantConversationKey = {
	siteId: number;
	agentId: string;
};

type WpcomSiteAssistantSessionState = {
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

type DollyHistoryMessage = {
	content: string;
	role: 'user' | 'assistant';
	createdAt: number;
	messageApiId?: number;
};

type DollyHistorySummary = {
	chatId: number;
	sessionId?: string;
	siteId?: number;
	createdAt?: number;
	firstMessage?: Record< string, unknown >;
	lastMessage?: Record< string, unknown >;
};

type DollyHistoryChat = {
	chatId: number;
	sessionId?: string;
	siteId?: number;
	createdAt?: number;
	messages: DollyHistoryMessage[];
};

type DollyPreviewContext = {
	isOpen: boolean;
	siteId: number;
	openedURL?: string;
	currentURL?: string;
	title?: string;
	isLoading: boolean;
};

type DollySiteAssociationContext = {
	status: 'wpcom_only';
	wpcomSiteId: number;
	wpcomSiteUrl: string;
	instructions: string;
};

const isRecord = ( value: unknown ): value is Record< string, unknown > =>
	typeof value === 'object' && value !== null;

const flexibleNumber = ( value: unknown ): number | undefined => {
	if ( typeof value === 'number' ) {
		return value;
	}
	if ( typeof value === 'string' ) {
		const parsed = Number( value );
		return Number.isFinite( parsed ) ? parsed : undefined;
	}
	return undefined;
};

const getFlexibleNumberValue = (
	record: Record< string, unknown >,
	possibleKeys: string[]
): number | undefined => {
	for ( const key of possibleKeys ) {
		const value = flexibleNumber( record[ key ] );
		if ( value && value > 0 ) {
			return value;
		}
	}
};

const getStringFromRecord = (
	record: Record< string, unknown >,
	possibleKeys: string[]
): string | undefined => {
	for ( const key of possibleKeys ) {
		const value = record[ key ];
		if ( typeof value === 'string' && value.trim() ) {
			return value.trim();
		}
	}
};

const hasHttpProtocol = ( url: URL ) => url.protocol === 'http:' || url.protocol === 'https:';

const formatSiteBaseUrl = ( url: URL ) => {
	if ( url.pathname === '/' && ! url.search && ! url.hash ) {
		return url.origin;
	}
	return url.toString();
};

const normalizeSiteBaseUrl = ( value?: string ): string | undefined => {
	const trimmedValue = value?.trim();
	if ( ! trimmedValue ) {
		return undefined;
	}

	const parseUrl = ( candidate: string ) => {
		try {
			const url = new URL( candidate );
			return hasHttpProtocol( url ) ? formatSiteBaseUrl( url ) : undefined;
		} catch {
			return undefined;
		}
	};

	const normalizedUrl = parseUrl( trimmedValue );
	if ( normalizedUrl ) {
		return normalizedUrl;
	}

	if ( trimmedValue.startsWith( '//' ) ) {
		return parseUrl( `https:${ trimmedValue }` );
	}

	if ( trimmedValue.startsWith( '/' ) ) {
		return undefined;
	}

	return parseUrl( `https://${ trimmedValue }` );
};

const parseDollySites = ( response: unknown ): DollySite[] => {
	if ( ! isRecord( response ) || ! Array.isArray( response.sites ) ) {
		throw new Error( 'Invalid Dolly sites response' );
	}

	return response.sites
		.map< DollySite | undefined >( ( site ) => {
			if ( ! isRecord( site ) ) {
				return undefined;
			}

			const id =
				flexibleNumber( site.ID ) ?? flexibleNumber( site.blog_id ) ?? flexibleNumber( site.id );
			if ( ! id ) {
				return undefined;
			}

			const name = typeof site.name === 'string' ? site.name : '';
			const url = typeof site.URL === 'string' ? site.URL : undefined;
			const primaryDomain =
				typeof site.primary_domain === 'string' ? site.primary_domain : undefined;
			const slug = typeof site.slug === 'string' ? site.slug : primaryDomain;
			const normalizedUrl = normalizeSiteBaseUrl( url ) ?? normalizeSiteBaseUrl( primaryDomain );
			const dollySite: DollySite = {
				id,
				name: name.trim() || slug || normalizedUrl || String( id ),
			};

			if ( normalizedUrl ) {
				dollySite.url = normalizedUrl;
			}
			if ( slug ) {
				dollySite.slug = slug;
			}

			return dollySite;
		} )
		.filter( ( site ): site is DollySite => Boolean( site ) );
};

const createSyncSiteFromDollySite = ( site: DollySite ): SyncSite | undefined => {
	const url = normalizeSiteBaseUrl( site.url );
	if ( ! url ) {
		return undefined;
	}

	return {
		id: site.id,
		localSiteId: '',
		name: site.name,
		url,
		isStaging: false,
		isPressable: false,
		syncSupport: 'syncable',
		lastPullTimestamp: null,
		lastPushTimestamp: null,
	};
};

const createWpcomRequest = < T, >(
	description: string,
	timeoutMs: number,
	executor: ( resolve: ( data: T ) => void, reject: ( error: Error ) => void ) => void
): Promise< T > =>
	new Promise( ( resolve, reject ) => {
		let isSettled = false;
		const timeout = setTimeout( () => {
			if ( isSettled ) {
				return;
			}
			isSettled = true;
			reject( new Error( `${ description } timed out.` ) );
		}, timeoutMs );
		const settle = ( callback: () => void ) => {
			if ( isSettled ) {
				return;
			}
			isSettled = true;
			clearTimeout( timeout );
			callback();
		};

		try {
			executor(
				( data ) => settle( () => resolve( data ) ),
				( error ) => settle( () => reject( error ) )
			);
		} catch ( error ) {
			settle( () => reject( error instanceof Error ? error : new Error( description ) ) );
		}
	} );

const wpcomGet = async < T, >(
	client: WPCOM,
	path: string,
	timeoutMs = DOLLY_REQUEST_TIMEOUT_MS
): Promise< T > =>
	createWpcomRequest< T >( `Dolly request to ${ path }`, timeoutMs, ( resolve, reject ) => {
		void client.req.get(
			{
				path,
				apiNamespace: 'wpcom/v2',
			},
			( error: Error | null, data: unknown ) => {
				if ( error ) {
					reject( error );
					return;
				}
				resolve( data as T );
			}
		);
	} );

const extractBackendSelectedSiteIdFromRecord = (
	record: Record< string, unknown >
): number | undefined =>
	getFlexibleNumberValue( record, [
		'selectedSiteId',
		'selected_site_id',
		'siteId',
		'site_id',
		'blog_id',
		'blogID',
	] );

const extractBackendSelectedSiteId = ( response: unknown ): number | undefined => {
	if ( ! isRecord( response ) ) {
		return undefined;
	}

	return (
		extractBackendSelectedSiteIdFromRecord( response ) ??
		( isRecord( response.result )
			? extractBackendSelectedSiteIdFromRecord( response.result )
			: undefined )
	);
};

const extractDollyHistoryEntries = ( response: unknown ): Record< string, unknown >[] => {
	if ( Array.isArray( response ) ) {
		return response.filter( isRecord );
	}
	if ( ! isRecord( response ) ) {
		return [];
	}
	for ( const key of [ 'chats', 'conversations', 'data' ] ) {
		const value = response[ key ];
		if ( Array.isArray( value ) ) {
			return value.filter( isRecord );
		}
	}
	return [];
};

const parseDollySessionSiteId = ( response: unknown, sessionId: string ): number | undefined => {
	const entries = extractDollyHistoryEntries( response );
	const matchingEntry = entries.find(
		( entry ) => getStringFromRecord( entry, [ 'sessionId', 'session_id' ] ) === sessionId
	);

	return matchingEntry ? extractBackendSelectedSiteIdFromRecord( matchingEntry ) : undefined;
};

const fetchDollySessionSiteId = async (
	client: WPCOM,
	sessionId?: string
): Promise< number | undefined > => {
	if ( ! sessionId || typeof ( client.req as { get?: unknown } ).get !== 'function' ) {
		return undefined;
	}

	try {
		const query = new URLSearchParams( {
			truncation_method: 'last_message',
			page_number: '1',
			items_per_page: '20',
		} );
		const response = await wpcomGet< unknown >(
			client,
			`/ai/chats/${ DOLLY_HISTORY_BOT_ID }?${ query.toString() }`
		);
		return parseDollySessionSiteId( response, sessionId );
	} catch ( error ) {
		console.error( error );
		return undefined;
	}
};

const resolveBackendSelectedSiteId = async (
	client: WPCOM,
	response: DollyAgentResponse,
	previousSessionId?: string
): Promise< number | undefined > =>
	response.selectedSiteId ??
	fetchDollySessionSiteId( client, response.sessionId ?? previousSessionId );

const fetchDollySite = async ( client: WPCOM, siteId: number ): Promise< SyncSite | undefined > => {
	try {
		const response = await wpcomGet< unknown >( client, '/ai/agent/dolly/sites' );
		const site = parseDollySites( response ).find( ( candidate ) => candidate.id === siteId );
		return site ? createSyncSiteFromDollySite( site ) : undefined;
	} catch ( error ) {
		console.error( error );
		return undefined;
	}
};

const parseDollyHistoryDate = ( value: unknown ): number | undefined => {
	if ( typeof value !== 'string' || ! value.trim() ) {
		return undefined;
	}

	const trimmedValue = value.trim();
	if ( /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test( trimmedValue ) ) {
		const parsedUtcDate = Date.parse( `${ trimmedValue.replace( ' ', 'T' ) }Z` );
		return Number.isFinite( parsedUtcDate ) ? parsedUtcDate : undefined;
	}

	const parsedDate = Date.parse( trimmedValue );
	if ( Number.isFinite( parsedDate ) ) {
		return parsedDate;
	}

	const parsedUtcDate = Date.parse( `${ trimmedValue.replace( ' ', 'T' ) }Z` );
	return Number.isFinite( parsedUtcDate ) ? parsedUtcDate : undefined;
};

const visibleDollyHistoryMessageText = ( value: string ) => {
	const trimmedValue = value.trim();
	if ( ! trimmedValue.startsWith( 'Local workspace context:' ) ) {
		return trimmedValue;
	}

	const marker = '\nUser message:\n';
	const markerIndex = trimmedValue.lastIndexOf( marker );
	if ( markerIndex === -1 ) {
		return trimmedValue;
	}

	const visibleText = trimmedValue.slice( markerIndex + marker.length ).trim();
	return visibleText || trimmedValue;
};

const parseDollyHistoryMessage = ( value: unknown ): DollyHistoryMessage | undefined => {
	if ( ! isRecord( value ) ) {
		return undefined;
	}

	const rawContent = getStringFromRecord( value, [ 'content', 'text', 'message' ] );
	if ( ! rawContent ) {
		return undefined;
	}

	const rawRole = getStringFromRecord( value, [ 'role' ] )?.toLowerCase();
	const role =
		rawRole === 'user'
			? 'user'
			: rawRole === 'bot' || rawRole === 'assistant' || rawRole === 'agent'
			? 'assistant'
			: undefined;
	if ( ! role ) {
		return undefined;
	}

	const content =
		role === 'user' ? visibleDollyHistoryMessageText( rawContent ) : rawContent.trim();
	if ( ! content ) {
		return undefined;
	}

	return {
		content,
		role,
		createdAt: parseDollyHistoryDate( value.created_at ?? value.createdAt ) ?? Date.now(),
		messageApiId: getFlexibleNumberValue( value, [ 'message_id', 'messageID', 'id' ] ),
	};
};

const createMessagesFromDollyHistory = ( messages: DollyHistoryMessage[] ): MessageType[] =>
	messages.map( ( message, index ) => ( {
		id: index,
		content: message.content,
		role: message.role,
		createdAt: message.createdAt,
		feedbackReceived: false,
		messageApiId: message.messageApiId,
	} ) );

const createDollyHistoryMessageKey = ( message: DollyHistoryMessage ) =>
	message.messageApiId !== undefined
		? `id:${ message.messageApiId }`
		: `fallback:${ message.createdAt }:${ message.role }:${ message.content }`;

const sortDollyHistoryMessages = ( messages: DollyHistoryMessage[] ) =>
	[ ...messages ].sort( ( first, second ) => {
		const dateComparison = first.createdAt - second.createdAt;
		if ( dateComparison !== 0 ) {
			return dateComparison;
		}
		return ( first.messageApiId ?? 0 ) - ( second.messageApiId ?? 0 );
	} );

const deduplicateDollyHistoryMessages = ( messages: DollyHistoryMessage[] ) => {
	const seenMessages = new Set< string >();
	return sortDollyHistoryMessages( messages ).filter( ( message ) => {
		const key = createDollyHistoryMessageKey( message );
		if ( seenMessages.has( key ) ) {
			return false;
		}
		seenMessages.add( key );
		return true;
	} );
};

const createDollyHistoryFallbackMessages = ( summary: DollyHistorySummary ) =>
	[ summary.firstMessage, summary.lastMessage ]
		.map( parseDollyHistoryMessage )
		.filter( ( message ): message is DollyHistoryMessage => Boolean( message ) );

const parseDollyHistorySummary = ( value: unknown ): DollyHistorySummary | undefined => {
	if ( ! isRecord( value ) ) {
		return undefined;
	}

	const chatId = getFlexibleNumberValue( value, [ 'chat_id', 'chatID', 'id' ] );
	if ( ! chatId ) {
		return undefined;
	}

	return {
		chatId,
		sessionId: getStringFromRecord( value, [ 'session_id', 'sessionId' ] ),
		siteId: extractBackendSelectedSiteIdFromRecord( value ),
		createdAt: parseDollyHistoryDate( value.created_at ?? value.createdAt ),
		firstMessage: isRecord( value.first_message ) ? value.first_message : undefined,
		lastMessage: isRecord( value.last_message ) ? value.last_message : undefined,
	};
};

const parseDollyHistoryChat = (
	value: unknown,
	summary: DollyHistorySummary,
	includeFallbackMessages = true
): DollyHistoryChat | undefined => {
	if ( ! isRecord( value ) ) {
		return undefined;
	}

	const chatId = getFlexibleNumberValue( value, [ 'chat_id', 'chatID', 'id' ] ) ?? summary.chatId;
	const rawMessages = Array.isArray( value.messages ) ? value.messages : [];
	const messages = rawMessages
		.map( parseDollyHistoryMessage )
		.filter( ( message ): message is DollyHistoryMessage => Boolean( message ) );
	const fallbackMessages = includeFallbackMessages
		? createDollyHistoryFallbackMessages( summary )
		: [];

	return {
		chatId,
		sessionId: getStringFromRecord( value, [ 'session_id', 'sessionId' ] ) ?? summary.sessionId,
		siteId: extractBackendSelectedSiteIdFromRecord( value ) ?? summary.siteId,
		createdAt: parseDollyHistoryDate( value.created_at ?? value.createdAt ) ?? summary.createdAt,
		messages: messages.length > 0 ? messages : fallbackMessages,
	};
};

const createWpcomSiteAssistantSessionStateFromHistory = (
	selectedWpcomSite: SyncSite,
	summary: DollyHistorySummary,
	chat?: DollyHistoryChat
): WpcomSiteAssistantSessionState | undefined => {
	const fallbackMessages = createDollyHistoryFallbackMessages( summary );
	const messages = chat?.messages.length ? chat.messages : fallbackMessages;
	if ( messages.length === 0 ) {
		return undefined;
	}

	const lastUpdated =
		messages[ messages.length - 1 ]?.createdAt ??
		chat?.createdAt ??
		summary.createdAt ??
		Date.now();

	return {
		id: `wpcom:${ DOLLY_AGENT_ID }:${ summary.chatId }`,
		key: {
			siteId: selectedWpcomSite.id,
			agentId: DOLLY_AGENT_ID,
		},
		remoteChatId: summary.chatId,
		serverHydrationDisabled: false,
		input: '',
		messages: createMessagesFromDollyHistory( messages ),
		sessionId: chat?.sessionId ?? summary.sessionId,
		activeWpcomSite: selectedWpcomSite,
		previewState: initialPreviewState(),
		lastUpdated,
	};
};

const createWpcomSiteAssistantSessionStateFromHistoryItems = (
	selectedWpcomSite: SyncSite,
	historyItems: Array< { summary: DollyHistorySummary; chat?: DollyHistoryChat } >
): WpcomSiteAssistantSessionState | undefined => {
	const sortedHistoryItems = [ ...historyItems ].sort(
		( first, second ) => ( second.summary.createdAt ?? 0 ) - ( first.summary.createdAt ?? 0 )
	);
	const latestHistoryItem = sortedHistoryItems[ 0 ];
	if ( ! latestHistoryItem ) {
		return undefined;
	}

	const messages = deduplicateDollyHistoryMessages(
		historyItems.flatMap( ( { summary, chat } ) =>
			chat?.messages.length ? chat.messages : createDollyHistoryFallbackMessages( summary )
		)
	);
	if ( messages.length === 0 ) {
		return undefined;
	}

	const chatWithSession = sortedHistoryItems.find( ( { chat } ) => chat?.sessionId );
	const lastUpdated =
		messages[ messages.length - 1 ]?.createdAt ??
		latestHistoryItem.chat?.createdAt ??
		latestHistoryItem.summary.createdAt ??
		Date.now();

	return {
		id: `wpcom:${ DOLLY_AGENT_ID }:${ latestHistoryItem.summary.chatId }`,
		key: {
			siteId: selectedWpcomSite.id,
			agentId: DOLLY_AGENT_ID,
		},
		remoteChatId: latestHistoryItem.summary.chatId,
		serverHydrationDisabled: false,
		input: '',
		messages: createMessagesFromDollyHistory( messages ),
		sessionId: chatWithSession?.chat?.sessionId ?? latestHistoryItem.summary.sessionId,
		activeWpcomSite: selectedWpcomSite,
		previewState: initialPreviewState(),
		lastUpdated,
	};
};

const fetchDollyHistorySummaries = async (
	client: WPCOM,
	itemsPerPage = DOLLY_HISTORY_SUMMARY_ITEMS_PER_PAGE,
	maxPages = DOLLY_HISTORY_MAX_PAGES
): Promise< DollyHistorySummary[] > => {
	const summaries: DollyHistorySummary[] = [];
	const seenChatIds = new Set< number >();

	for ( let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1 ) {
		const query = new URLSearchParams( {
			truncation_method: 'last_message',
			page_number: String( pageNumber ),
			items_per_page: String( itemsPerPage ),
		} );
		const response = await wpcomGet< unknown >(
			client,
			`/ai/chats/${ DOLLY_HISTORY_BOT_ID }?${ query.toString() }`
		);
		const pageSummaries = extractDollyHistoryEntries( response )
			.map( parseDollyHistorySummary )
			.filter( ( summary ): summary is DollyHistorySummary => Boolean( summary ) );

		for ( const summary of pageSummaries ) {
			if ( seenChatIds.has( summary.chatId ) ) {
				continue;
			}
			seenChatIds.add( summary.chatId );
			summaries.push( summary );
		}

		if ( pageSummaries.length < itemsPerPage ) {
			break;
		}
	}

	return summaries;
};

const fetchDollyHistoryChatPage = async (
	client: WPCOM,
	summary: DollyHistorySummary,
	pageNumber: number,
	itemsPerPage: number
): Promise< DollyHistoryChat | undefined > => {
	const query = new URLSearchParams( {
		page_number: String( pageNumber ),
		items_per_page: String( itemsPerPage ),
	} );
	const response = await wpcomGet< unknown >(
		client,
		`/ai/chat/${ DOLLY_HISTORY_BOT_ID }/${ summary.chatId }?${ query.toString() }`
	);
	return parseDollyHistoryChat( response, summary, pageNumber === 1 );
};

const fetchDollyHistoryChat = async (
	client: WPCOM,
	summary: DollyHistorySummary,
	itemsPerPage = DOLLY_HISTORY_CHAT_ITEMS_PER_PAGE,
	maxPages = DOLLY_HISTORY_MAX_PAGES
): Promise< DollyHistoryChat | undefined > => {
	const messages: DollyHistoryMessage[] = [];
	let mergedChat: DollyHistoryChat | undefined;

	for ( let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1 ) {
		const chatPage = await fetchDollyHistoryChatPage( client, summary, pageNumber, itemsPerPage );
		if ( ! chatPage ) {
			break;
		}

		mergedChat = {
			...chatPage,
			sessionId: mergedChat?.sessionId ?? chatPage.sessionId,
			siteId: mergedChat?.siteId ?? chatPage.siteId,
			createdAt: mergedChat?.createdAt ?? chatPage.createdAt,
			messages,
		};
		messages.push( ...chatPage.messages );

		if ( chatPage.messages.length < itemsPerPage ) {
			break;
		}
	}

	if ( ! mergedChat ) {
		return undefined;
	}

	return {
		...mergedChat,
		messages: deduplicateDollyHistoryMessages( messages ),
	};
};

const hydrateWpcomSiteAssistantSessionState = async (
	client: WPCOM,
	selectedWpcomSite: SyncSite,
	preferredSessionId?: string
): Promise< WpcomSiteAssistantSessionState | undefined > => {
	const summaries = await fetchDollyHistorySummaries( client );
	const normalizedPreferredSessionId = normalizeDollySessionId( preferredSessionId );
	const sortedSummaries = [ ...summaries ].sort(
		( first, second ) => ( second.createdAt ?? 0 ) - ( first.createdAt ?? 0 )
	);
	const preferredSessionSummaries = normalizedPreferredSessionId
		? sortedSummaries.filter(
				( summary ) =>
					normalizeDollySessionId( summary.sessionId ) === normalizedPreferredSessionId &&
					( summary.siteId === selectedWpcomSite.id || summary.siteId === undefined )
		  )
		: [];
	const siteSummaries = sortedSummaries
		.filter( ( summary ) => summary.siteId === selectedWpcomSite.id )
		.sort( ( first, second ) => ( second.createdAt ?? 0 ) - ( first.createdAt ?? 0 ) );
	const summary = preferredSessionSummaries[ 0 ] ?? siteSummaries[ 0 ];
	if ( ! summary ) {
		return undefined;
	}

	const normalizedSessionId =
		normalizeDollySessionId( summary.sessionId ) ?? normalizedPreferredSessionId;
	const targetSummaries = normalizedSessionId
		? sortedSummaries.filter(
				( candidate ) =>
					normalizeDollySessionId( candidate.sessionId ) === normalizedSessionId &&
					( candidate.siteId === selectedWpcomSite.id ||
						candidate.siteId === undefined ||
						candidate.chatId === summary.chatId )
		  )
		: [ summary ];
	const historyItems: Array< { summary: DollyHistorySummary; chat?: DollyHistoryChat } > = [];

	for ( const targetSummary of targetSummaries ) {
		try {
			historyItems.push( {
				summary: targetSummary,
				chat: await fetchDollyHistoryChat( client, targetSummary ),
			} );
		} catch ( error ) {
			console.error( error );
			historyItems.push( { summary: targetSummary } );
		}
	}

	return (
		createWpcomSiteAssistantSessionStateFromHistoryItems( selectedWpcomSite, historyItems ) ??
		createWpcomSiteAssistantSessionStateFromHistory( selectedWpcomSite, summary )
	);
};

const getStringValue = (
	record: Record< string, unknown >,
	possibleKeys: string[]
): string | undefined => {
	for ( const key of possibleKeys ) {
		const value = record[ key ];
		if ( typeof value === 'string' && value.trim() ) {
			return value.trim();
		}
	}
};

const getBooleanValue = (
	record: Record< string, unknown >,
	possibleKeys: string[]
): boolean | undefined => {
	for ( const key of possibleKeys ) {
		const value = record[ key ];
		if ( typeof value === 'boolean' ) {
			return value;
		}
		if ( typeof value === 'string' ) {
			const normalizedValue = value.trim().toLowerCase();
			if ( normalizedValue === 'true' ) {
				return true;
			}
			if ( normalizedValue === 'false' ) {
				return false;
			}
		}
	}
};

const shouldForcePreviewReload = ( toolArguments: Record< string, unknown > ): boolean =>
	getBooleanValue( toolArguments, [
		'siteChanged',
		'site_changed',
		'previewNeedsRefresh',
		'preview_needs_refresh',
	] ) === true;

const createDollyPreviewAbility = ( callback: NonNullable< Ability[ 'callback' ] > ): Ability => ( {
	name: DOLLY_PREVIEW_TOOL_ID,
	label: 'Preview URL',
	description:
		'Open a web URL in the WordPress Studio side preview panel. Replaces any preview that is already open, but does not reload the current URL unless siteChanged is true.',
	category: 'interface',
	input_schema: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description:
					'The absolute http or https URL to preview. Studio also accepts paths relative to the selected WordPress.com site, such as / or /wp-admin/.',
			},
			title: {
				type: 'string',
				description: 'Optional short title to show in the preview header.',
			},
			siteChanged: {
				type: 'boolean',
				description:
					'Set true only after changing the selected WordPress.com site so Studio refreshes the current preview.',
			},
		},
		required: [ 'url' ],
	},
	output_schema: {
		type: 'object',
		properties: {
			success: { type: 'boolean' },
			url: { type: 'string' },
			message: { type: 'string' },
		},
	},
	meta: {
		annotations: {
			instructions:
				'Use when the user asks to open, show, inspect, preview, or keep a URL visible beside the chat. Set siteChanged=true only when a preceding action changed site content, settings, theme, plugins, or other visible state that should be reloaded.',
			readonly: false,
			destructive: false,
			idempotent: true,
		},
	},
	callback,
} );

const createDollyRefreshPreviewAbility = (
	callback: NonNullable< Ability[ 'callback' ] >
): Ability => ( {
	name: DOLLY_REFRESH_PREVIEW_TOOL_ID,
	label: 'Refresh Preview',
	description:
		'Refresh the currently open WordPress Studio side preview panel after the selected WordPress.com site has changed. Does not open the preview when it is hidden.',
	category: 'interface',
	input_schema: {
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description:
					'Optional absolute http or https URL, or path relative to the selected WordPress.com site. When omitted, Studio refreshes the currently open preview URL.',
			},
			title: {
				type: 'string',
				description: 'Optional short title to show in the preview header.',
			},
			reason: {
				type: 'string',
				description: 'Short reason the preview needs to refresh.',
			},
		},
	},
	output_schema: {
		type: 'object',
		properties: {
			success: { type: 'boolean' },
			refreshed: { type: 'boolean' },
			url: { type: 'string' },
			message: { type: 'string' },
		},
	},
	meta: {
		annotations: {
			instructions:
				'Use immediately after successfully changing visible site content, pages, posts, navigation, templates, theme, plugins, settings, or other selected-site state when clientContext.preview.isOpen is true. Call before the final user-facing reply so the open preview reflects the change. Do not call for read-only lookups or when the preview is hidden.',
			readonly: false,
			destructive: false,
			idempotent: true,
		},
	},
	callback,
} );

const createDollyPreviewAbilities = ( {
	activeWpcomSite,
	previewState,
	openPreview,
}: DollyPreviewAbilityContext ): Ability[] => [
	createDollyPreviewAbility( ( input: Record< string, unknown > ) => {
		const requestedUrl = getStringValue( input, [ 'url', 'URL', 'uri', 'path' ] );
		if ( ! requestedUrl ) {
			return {
				success: false,
				error: 'Preview needs a valid URL or WordPress.com site path.',
			};
		}

		const title = getStringValue( input, [ 'title', 'name' ] );
		const normalizedUrl = normalizePreviewUrl( activeWpcomSite.url, requestedUrl );
		openPreview( requestedUrl, title, {
			forceReload: shouldForcePreviewReload( input ),
		} );
		const displayTitle = title || new URL( normalizedUrl ).host || normalizedUrl;

		return {
			success: true,
			url: normalizedUrl,
			message: sprintf( __( 'Opened preview: %s' ), displayTitle ),
		};
	} ),
	createDollyRefreshPreviewAbility( ( input: Record< string, unknown > ) => {
		const requestedUrl = getStringValue( input, [ 'url', 'URL', 'uri', 'path' ] );
		const title = getStringValue( input, [ 'title', 'name' ] ) ?? previewState.title;
		const refreshUrl = requestedUrl || previewState.currentUrl || previewState.pathOrUrl || '/';
		const normalizedUrl = normalizePreviewUrl( activeWpcomSite.url, refreshUrl );

		if ( ! previewState.open ) {
			return {
				success: true,
				refreshed: false,
				url: normalizedUrl,
				message: __( 'Preview is hidden, so there was nothing to refresh.' ),
			};
		}

		openPreview( refreshUrl, title, {
			forceReload: true,
		} );
		const displayTitle = title || new URL( normalizedUrl ).host || normalizedUrl;

		return {
			success: true,
			refreshed: true,
			url: normalizedUrl,
			message: sprintf( __( 'Refreshed preview: %s' ), displayTitle ),
		};
	} ),
];

const createDollyClientContext = (
	siteId: number,
	selectedSite: SyncSite,
	previewContext?: DollyPreviewContext,
	siteAssociation?: DollySiteAssociationContext
) => ( {
	constructorArguments: {
		client: DOLLY_HISTORY_CLIENT,
	},
	selectedSiteId: siteId,
	preview: previewContext,
	studioSiteAssociation: siteAssociation,
	frontendAbilities: DOLLY_FRONTEND_ABILITIES,
	wpworkspace: {
		appName: window.appGlobals?.appName ?? 'WordPress Studio',
		currentActivity: 'Working on a WordPress.com site selected from Studio',
		clientVersion: window.appGlobals?.appVersion,
		preview: previewContext,
		studioSiteAssociation: siteAssociation,
		frontendAbilities: DOLLY_FRONTEND_ABILITIES,
		previewRefreshPolicy: {
			afterVisibleSiteChange:
				'When a successful action changes the selected site and preview.isOpen is true, call wpworkspace/refresh_preview before the final reply.',
			hiddenPreviewBehavior:
				'Do not open a hidden preview just to auto-refresh. Use wpworkspace/preview only when the user asks to open or show a preview.',
		},
		selectedSite: {
			id: selectedSite.id,
			name: selectedSite.name,
			url: selectedSite.url,
			siteId,
			kind: 'wpcom-site',
		},
	},
} );

const createDollyContextProvider = (
	siteId: number,
	selectedSite: SyncSite,
	previewContext?: DollyPreviewContext,
	siteAssociation?: DollySiteAssociationContext
): ContextProvider => ( {
	getClientContext: () =>
		createDollyClientContext( siteId, selectedSite, previewContext, siteAssociation ),
} );

const createDollyAuthProvider = () => async (): Promise< Record< string, string > > => {
	const token = await getIpcApi().getAuthenticationToken();
	return token?.accessToken ? { Authorization: `Bearer ${ token.accessToken }` } : {};
};

const createDollyAgentUrl = ( siteId: number ) =>
	`${ DOLLY_AGENT_URL_ORIGIN }/sites/${ siteId }/ai/agent`;

const createDollyFilePart = ( image: DollyUploadedImage ): FilePart => ( {
	type: 'file',
	file: {
		name: image.name,
		mimeType: image.mimeType,
		uri: image.url,
	},
	metadata: {
		id: image.id,
		url: image.url,
		mimeType: image.mimeType,
		name: image.name,
		title: image.title ?? image.name,
		fileName: image.fileName,
		fileType: image.mimeType,
	},
} );

const createDollyMessage = ( message: string, uploadedImages: DollyUploadedImage[] = [] ) => {
	const agentticMessage = createTextMessage( message );
	return {
		...agentticMessage,
		parts: [ ...agentticMessage.parts, ...uploadedImages.map( createDollyFilePart ) ],
	};
};

const revokeDollyPendingImageUrls = ( images: DollyPendingImage[] ) => {
	images.forEach( ( image ) => URL.revokeObjectURL( image.url ) );
};

const readFileAsDataUrl = ( file: File ) =>
	new Promise< string >( ( resolve, reject ) => {
		const reader = new FileReader();
		reader.onload = () => {
			if ( typeof reader.result === 'string' ) {
				resolve( reader.result );
				return;
			}
			reject( new Error( __( 'Unable to prepare image preview.' ) ) );
		};
		reader.onerror = () =>
			reject( reader.error ?? new Error( __( 'Unable to prepare image preview.' ) ) );
		reader.readAsDataURL( file );
	} );

const createDollyPendingVisibleImages = async (
	images: DollyPendingImage[]
): Promise< DollyVisibleImage[] > =>
	Promise.all(
		images.map( async ( image ) => ( {
			name: image.name ?? image.file.name,
			url: image.dataUrl ?? ( await readFileAsDataUrl( image.file ) ),
		} ) )
	);

const getRawStringValue = ( value: unknown ) => ( typeof value === 'string' ? value : undefined );

const getNumberValue = ( value: unknown ) => {
	if ( typeof value === 'number' ) {
		return value;
	}
	if ( typeof value === 'string' ) {
		const parsedValue = Number.parseInt( value, 10 );
		return Number.isNaN( parsedValue ) ? undefined : parsedValue;
	}
	return undefined;
};

const getFileNameFromUrl = ( url: string ) => {
	try {
		return decodeURIComponent( new URL( url ).pathname.split( '/' ).filter( Boolean ).pop() ?? '' );
	} catch {
		return '';
	}
};

const removeFileExtension = ( fileName: string ) => fileName.replace( /\.[^.]+$/, '' );

const getDollyUploadErrorMessage = ( data: unknown ) => {
	if ( ! data || typeof data !== 'object' ) {
		return undefined;
	}

	const errors = ( data as { errors?: unknown } ).errors;
	if ( ! Array.isArray( errors ) ) {
		return undefined;
	}

	return errors
		.map( ( error ) => {
			if ( ! error || typeof error !== 'object' ) {
				return undefined;
			}
			return getRawStringValue( ( error as { message?: unknown } ).message );
		} )
		.find( Boolean );
};

const createDollyRequestAbortError = () => {
	const message = 'Dolly request was stopped.';
	if ( typeof DOMException !== 'undefined' ) {
		return new DOMException( message, 'AbortError' );
	}

	const error = new Error( message );
	error.name = 'AbortError';
	return error;
};

const throwIfDollyRequestAborted = ( abortSignal?: AbortSignal ) => {
	if ( abortSignal?.aborted ) {
		throw createDollyRequestAbortError();
	}
};

const normalizeDollyUploadedImage = (
	rawMedia: unknown,
	originalImage: DollyPendingImage
): DollyUploadedImage | undefined => {
	if ( ! rawMedia || typeof rawMedia !== 'object' ) {
		return undefined;
	}

	const media = rawMedia as Record< string, unknown >;
	const id = getNumberValue( media.ID ) ?? getNumberValue( media.id ) ?? 0;
	const url = getRawStringValue( media.URL ) ?? getRawStringValue( media.url ) ?? '';
	const mimeType =
		getRawStringValue( media.mime_type ) ||
		getRawStringValue( media.mimeType ) ||
		originalImage.file.type ||
		'application/octet-stream';
	const fileName = getRawStringValue( media.file ) ?? originalImage.file.name;
	const title =
		getRawStringValue( media.title ) ??
		getRawStringValue( media.name ) ??
		removeFileExtension( fileName );
	const name = title || getFileNameFromUrl( url ) || originalImage.file.name;

	if ( id <= 0 || ! url.trim() ) {
		return undefined;
	}

	return {
		id,
		url,
		name,
		mimeType,
		fileName,
		title,
	};
};

const uploadDollyImages = async (
	siteId: number,
	images: DollyPendingImage[],
	abortSignal?: AbortSignal
): Promise< DollyUploadedImage[] > => {
	if ( images.length === 0 ) {
		return [];
	}

	const token = await getIpcApi().getAuthenticationToken();
	throwIfDollyRequestAborted( abortSignal );
	if ( ! token?.accessToken ) {
		throw new Error( __( 'Log in to WordPress.com before uploading images.' ) );
	}

	const formData = new FormData();
	images.forEach( ( image, index ) => {
		formData.append( 'media[]', image.file, image.file.name );
		formData.append( `attrs[${ index }][title]`, removeFileExtension( image.file.name ) );
	} );

	const response = await fetch( `${ DOLLY_MEDIA_UPLOAD_URL_ORIGIN }/sites/${ siteId }/media/new`, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			Authorization: `Bearer ${ token.accessToken }`,
		},
		body: formData,
		signal: abortSignal,
	} );
	const data: unknown = await response.json().catch( () => undefined );

	if ( ! response.ok ) {
		throw new Error(
			getDollyUploadErrorMessage( data ) ?? __( 'The image upload failed. Please try again.' )
		);
	}

	const media =
		data && typeof data === 'object' ? ( data as { media?: unknown } ).media : undefined;
	if ( ! Array.isArray( media ) ) {
		throw new Error( __( 'The image upload response was missing media details.' ) );
	}

	const uploadedImages = media
		.map( ( rawMedia, index ) => normalizeDollyUploadedImage( rawMedia, images[ index ] ) )
		.filter( ( image ): image is DollyUploadedImage => Boolean( image ) );

	if ( uploadedImages.length !== images.length ) {
		throw new Error( __( 'The image upload response was missing attachment metadata.' ) );
	}

	return uploadedImages;
};

const escapeMarkdownAltText = ( value: string ) => value.replace( /[[\]\\]/g, '\\$&' );

const createDollyVisibleMessage = (
	message: string,
	images: DollyVisibleImage[],
	fallbackImageCount: number
) => {
	const imageMarkdown = images
		.map( ( image ) => `![${ escapeMarkdownAltText( image.name ) }](${ image.url })` )
		.join( '\n' );
	const attachmentLabel =
		images.length > 0
			? imageMarkdown
			: fallbackImageCount > 0
			? sprintf(
					_n( '%d image attached', '%d images attached', fallbackImageCount ),
					fallbackImageCount
			  )
			: '';

	return [ message, attachmentLabel ].filter( Boolean ).join( '\n\n' );
};

const createDollyImagePrompt = ( imageCount: number ) =>
	imageCount === 1
		? __( 'Please look at the attached image.' )
		: __( 'Please look at the attached images.' );

const DollyOptimisticImages = ( { images = [] }: { images?: DollyVisibleImage[] } ) => (
	<div className="flex flex-col gap-2">
		{ images.map( ( image ) => (
			<img key={ image.url } src={ image.url } alt={ image.name } loading="lazy" />
		) ) }
	</div>
);

const preloadDollyImageUrls = ( images: DollyVisibleImage[] ) =>
	Promise.all(
		images.map(
			( image ) =>
				new Promise< void >( ( resolve ) => {
					if ( typeof Image === 'undefined' ) {
						resolve();
						return;
					}

					const preloadImage = new Image();
					let didFinish = false;
					const finish = () => {
						if ( didFinish ) {
							return;
						}
						didFinish = true;
						window.clearTimeout( timeoutId );
						resolve();
					};
					const timeoutId = window.setTimeout( finish, DOLLY_IMAGE_PRELOAD_TIMEOUT_MS );
					preloadImage.onload = finish;
					preloadImage.onerror = finish;
					preloadImage.src = image.url;
				} )
		)
	);

const getErrorMessage = ( error: unknown ) =>
	error instanceof Error ? error.message : String( error );

const isDollyRequestAbortError = ( error: unknown ) =>
	( typeof DOMException !== 'undefined' &&
		error instanceof DOMException &&
		error.name === 'AbortError' ) ||
	( error instanceof Error && error.name === 'AbortError' );

const shouldRetryDollyMediaRequest = ( error: unknown, uploadedImages: DollyUploadedImage[] ) =>
	uploadedImages.length > 0 &&
	getErrorMessage( error ).toLowerCase().includes( 'processing the request' );

const delay = ( milliseconds: number, abortSignal?: AbortSignal ) =>
	new Promise< void >( ( resolve, reject ) => {
		if ( abortSignal?.aborted ) {
			reject( createDollyRequestAbortError() );
			return;
		}

		const timeoutId = window.setTimeout( () => {
			abortSignal?.removeEventListener( 'abort', abort );
			resolve();
		}, milliseconds );
		function abort() {
			window.clearTimeout( timeoutId );
			reject( createDollyRequestAbortError() );
		}
		abortSignal?.addEventListener( 'abort', abort, { once: true } );
	} );

const parseDollyTaskUpdate = (
	response: TaskUpdate,
	fallbackSessionId: string
): DollyAgentResponse => {
	if ( response.status.error ) {
		throw new Error( response.status.error.message || 'Dolly returned an error.' );
	}

	const messageText = response.status.message
		? extractTextFromMessage( response.status.message )
		: response.text;
	const text = messageText.trim();

	return {
		text: text || __( 'Dolly did not return a text response.' ),
		sessionId: response.sessionId ?? fallbackSessionId,
		selectedSiteId: extractBackendSelectedSiteId( response ),
	};
};

const isDollyToolResultProtocolError = ( error: unknown ) => {
	const message = error instanceof Error ? error.message : String( error );
	return (
		message.includes( 'Tool calls without results' ) ||
		message.includes( 'Protocol request error: Invalid message' )
	);
};

const sendDollyMessage = async ( {
	message,
	uploadedImages,
	previewContext,
	siteAssociation,
	selectedSite,
	sessionId,
	siteId,
	toolProvider,
	abortSignal,
}: {
	message: string;
	uploadedImages?: DollyUploadedImage[];
	previewContext?: DollyPreviewContext;
	siteAssociation?: DollySiteAssociationContext;
	selectedSite: SyncSite;
	sessionId?: string;
	siteId: number;
	toolProvider?: ToolProvider;
	abortSignal?: AbortSignal;
} ): Promise< DollyAgentResponse > => {
	const taskId = crypto.randomUUID();
	const initialSessionId = sessionId ?? taskId;
	const agentClient = createClient( {
		agentId: DOLLY_AGENT_ID,
		agentUrl: createDollyAgentUrl( siteId ),
		authProvider: createDollyAuthProvider(),
		contextProvider: createDollyContextProvider(
			siteId,
			selectedSite,
			previewContext,
			siteAssociation
		),
		toolProvider,
		timeout: DOLLY_REQUEST_TIMEOUT_MS,
	} );
	const sendInitialMessage = async ( nextTaskId: string, nextSessionId: string ) => {
		let finalUpdate: TaskUpdate | undefined;
		for await ( const update of agentClient.sendMessageStream( {
			message: createDollyMessage( message, uploadedImages ),
			sessionId: nextSessionId,
			taskId: nextTaskId,
			abortSignal,
			enableStreaming: false,
		} ) ) {
			finalUpdate = update;
		}

		if ( ! finalUpdate ) {
			throw new Error( __( 'Dolly did not return a response.' ) );
		}

		return parseDollyTaskUpdate( finalUpdate, nextSessionId );
	};
	let response: DollyAgentResponse | undefined;
	try {
		for ( let attempt = 0; ; attempt++ ) {
			try {
				response = await sendInitialMessage( taskId, initialSessionId );
				break;
			} catch ( error ) {
				if (
					attempt >= DOLLY_MEDIA_RETRY_DELAYS_MS.length ||
					! shouldRetryDollyMediaRequest( error, uploadedImages ?? [] )
				) {
					throw error;
				}
				await delay( DOLLY_MEDIA_RETRY_DELAYS_MS[ attempt ], abortSignal );
			}
		}
	} catch ( error ) {
		if (
			isDollyRequestAbortError( error ) ||
			abortSignal?.aborted ||
			! sessionId ||
			! isDollyToolResultProtocolError( error )
		) {
			throw error;
		}

		const freshTaskId = crypto.randomUUID();
		response = await sendInitialMessage( freshTaskId, freshTaskId );
	}
	if ( ! response ) {
		throw new Error( __( 'Dolly did not return a response.' ) );
	}
	return response;
};

const isElectron = (): boolean => {
	if ( typeof navigator === 'undefined' ) {
		return false;
	}
	return /\bElectron\//.test( navigator.userAgent );
};

const isHttpUrl = ( value: string ) => {
	try {
		const url = new URL( value );
		return hasHttpProtocol( url );
	} catch {
		return false;
	}
};

const normalizePreviewUrl = (
	baseUrl: string,
	rawValue: string,
	{ autoLoginSameOrigin = false }: { autoLoginSameOrigin?: boolean } = {}
) => {
	const trimmedValue = rawValue.trim();
	const normalizedBaseUrl = normalizeSiteBaseUrl( baseUrl );
	let targetUrl: URL;

	if ( isHttpUrl( trimmedValue ) ) {
		targetUrl = new URL( trimmedValue );
	} else if ( trimmedValue.includes( '.' ) && ! trimmedValue.startsWith( '/' ) ) {
		const normalizedRawUrl = normalizeSiteBaseUrl( trimmedValue );
		if ( ! normalizedRawUrl ) {
			return 'about:blank';
		}
		targetUrl = new URL( normalizedRawUrl );
	} else if ( normalizedBaseUrl ) {
		targetUrl = new URL( trimmedValue || '/', normalizedBaseUrl );
	} else {
		return 'about:blank';
	}

	if ( ! normalizedBaseUrl ) {
		return targetUrl.toString();
	}

	const siteOrigin = new URL( normalizedBaseUrl ).origin;
	if ( targetUrl.origin !== siteOrigin || ! autoLoginSameOrigin ) {
		return targetUrl.toString();
	}
	if ( targetUrl.pathname === '/studio-auto-login' ) {
		return targetUrl.toString();
	}

	const autoLoginUrl = new URL( '/studio-auto-login', normalizedBaseUrl );
	autoLoginUrl.searchParams.set( 'redirect_to', targetUrl.toString() );
	return autoLoginUrl.toString();
};

const createPreviewContext = (
	selectedSite: SyncSite,
	previewState: DollyPreviewState,
	previewUrl?: string
): DollyPreviewContext => ( {
	isOpen: previewState.open,
	siteId: selectedSite.id,
	openedURL: previewUrl,
	currentURL: previewState.currentUrl ?? previewUrl,
	title: previewState.pageTitle ?? previewState.title,
	isLoading: previewState.isLoading,
} );

const createWpcomOnlySiteAssociationContext = (
	selectedWpcomSite: SyncSite
): DollySiteAssociationContext => ( {
	status: 'wpcom_only',
	wpcomSiteId: selectedWpcomSite.id,
	wpcomSiteUrl: selectedWpcomSite.url,
	instructions:
		'This is a WordPress.com site selected from Studio that is not connected to a local Studio site. Dolly may manage this WordPress.com site. Studio local site controls, sync tabs, and local filesystem actions do not apply to this selection.',
} );

const initialPreviewState = (): DollyPreviewState => ( {
	open: false,
	pathOrUrl: '/',
	isLoading: false,
	reloadNonce: 0,
} );

const wpcomSiteAssistantSessionStateCache = new Map< string, WpcomSiteAssistantSessionState >();
let hasLoadedWpcomSiteAssistantSessionStateCache = false;

export const clearWpcomSiteAssistantStateCacheForTests = () => {
	wpcomSiteAssistantSessionStateCache.clear();
	hasLoadedWpcomSiteAssistantSessionStateCache = false;
	localStorage.removeItem( LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY );
};

const createWpcomSiteAssistantSessionKey = ( siteId: number ) => `wpcom-site:${ siteId }`;

const createWpcomSiteAssistantConversationId = () => `local:${ crypto.randomUUID() }`;

const cloneWpcomSiteAssistantSessionState = (
	sessionState: WpcomSiteAssistantSessionState
): WpcomSiteAssistantSessionState => ( {
	...sessionState,
	key: { ...sessionState.key },
	messages: sessionState.messages.map( ( message ) => {
		const { failedMessage: _failedMessage, ...messageWithoutRuntimeState } = message;
		return messageWithoutRuntimeState;
	} ),
	activeWpcomSite: { ...sessionState.activeWpcomSite },
	previewState: { ...sessionState.previewState },
} );

const normalizePersistedWpcomSiteAssistantSessionState = (
	value: unknown
): WpcomSiteAssistantSessionState | undefined => {
	if ( ! isRecord( value ) || ! isRecord( value.key ) || ! isRecord( value.activeWpcomSite ) ) {
		return undefined;
	}

	const siteId = flexibleNumber( value.key.siteId );
	const agentId = typeof value.key.agentId === 'string' ? value.key.agentId : undefined;
	const activeSiteId = flexibleNumber( value.activeWpcomSite.id );
	const activeSiteUrl =
		typeof value.activeWpcomSite.url === 'string' ? value.activeWpcomSite.url : undefined;

	if ( ! siteId || ! agentId || ! activeSiteId || ! activeSiteUrl ) {
		return undefined;
	}

	const id =
		typeof value.id === 'string' && value.id.trim()
			? value.id
			: createWpcomSiteAssistantConversationId();
	const previewState = isRecord( value.previewState )
		? {
				...initialPreviewState(),
				...value.previewState,
		  }
		: initialPreviewState();

	return {
		id,
		key: {
			siteId,
			agentId,
		},
		remoteChatId: flexibleNumber( value.remoteChatId ),
		serverHydrationDisabled:
			typeof value.serverHydrationDisabled === 'boolean' ? value.serverHydrationDisabled : false,
		input: typeof value.input === 'string' ? value.input : '',
		messages: Array.isArray( value.messages )
			? ( value.messages as MessageType[] ).map( ( message ) => {
					const { failedMessage: _failedMessage, ...messageWithoutRuntimeState } = message;
					return messageWithoutRuntimeState;
			  } )
			: [],
		sessionId: typeof value.sessionId === 'string' ? value.sessionId : undefined,
		activeWpcomSite: value.activeWpcomSite as SyncSite,
		previewState: {
			open: Boolean( previewState.open ),
			pathOrUrl: typeof previewState.pathOrUrl === 'string' ? previewState.pathOrUrl : '/',
			title: typeof previewState.title === 'string' ? previewState.title : undefined,
			currentUrl: typeof previewState.currentUrl === 'string' ? previewState.currentUrl : undefined,
			pageTitle: typeof previewState.pageTitle === 'string' ? previewState.pageTitle : undefined,
			isLoading: false,
			reloadNonce: flexibleNumber( previewState.reloadNonce ) ?? 0,
		},
		lastUpdated: flexibleNumber( value.lastUpdated ) ?? Date.now(),
	};
};

const loadWpcomSiteAssistantSessionStateCache = () => {
	if ( hasLoadedWpcomSiteAssistantSessionStateCache ) {
		return;
	}

	hasLoadedWpcomSiteAssistantSessionStateCache = true;
	const rawCache = localStorage.getItem( LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY );
	if ( ! rawCache ) {
		return;
	}

	try {
		const parsed = JSON.parse( rawCache );
		const persistedStates = isRecord( parsed ) ? Object.values( parsed ) : [];
		for ( const value of persistedStates ) {
			const sessionState = normalizePersistedWpcomSiteAssistantSessionState( value );
			if ( sessionState ) {
				wpcomSiteAssistantSessionStateCache.set(
					createWpcomSiteAssistantSessionKey( sessionState.key.siteId ),
					sessionState
				);
			}
		}
	} catch ( error ) {
		console.error( error );
	}
};

const persistWpcomSiteAssistantSessionStateCache = () => {
	const cache = Object.fromEntries(
		Array.from( wpcomSiteAssistantSessionStateCache.entries() ).map( ( [ key, value ] ) => [
			key,
			cloneWpcomSiteAssistantSessionState( value ),
		] )
	);
	localStorage.setItem( LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY, JSON.stringify( cache ) );
};

const createWpcomSiteAssistantSessionState = (
	selectedWpcomSite: SyncSite
): WpcomSiteAssistantSessionState => ( {
	id: createWpcomSiteAssistantConversationId(),
	key: {
		siteId: selectedWpcomSite.id,
		agentId: DOLLY_AGENT_ID,
	},
	remoteChatId: undefined,
	serverHydrationDisabled: true,
	input: '',
	messages: [],
	sessionId: undefined,
	activeWpcomSite: selectedWpcomSite,
	previewState: initialPreviewState(),
	lastUpdated: Date.now(),
} );

const getWpcomSiteAssistantSessionState = (
	sessionKey: string,
	selectedWpcomSite: SyncSite
): WpcomSiteAssistantSessionState => {
	loadWpcomSiteAssistantSessionStateCache();
	const cachedSessionState = wpcomSiteAssistantSessionStateCache.get( sessionKey );

	if ( ! cachedSessionState ) {
		return createWpcomSiteAssistantSessionState( selectedWpcomSite );
	}

	const sessionState = cloneWpcomSiteAssistantSessionState( cachedSessionState );
	return {
		...sessionState,
		activeWpcomSite:
			sessionState.activeWpcomSite.id === selectedWpcomSite.id
				? selectedWpcomSite
				: sessionState.activeWpcomSite,
	};
};

const normalizeDollySessionId = ( value?: string ) => {
	const trimmedValue = value?.trim();
	return trimmedValue || undefined;
};

const shouldApplyWpcomSiteAssistantHydration = (
	currentSessionState: WpcomSiteAssistantSessionState,
	hydratedSessionState: WpcomSiteAssistantSessionState
) => {
	const remoteChatMatches =
		currentSessionState.remoteChatId !== undefined &&
		currentSessionState.remoteChatId === hydratedSessionState.remoteChatId;
	const currentSessionId = normalizeDollySessionId( currentSessionState.sessionId );
	const hydratedSessionId = normalizeDollySessionId( hydratedSessionState.sessionId );
	const sessionMatches =
		currentSessionId !== undefined &&
		hydratedSessionId !== undefined &&
		currentSessionId === hydratedSessionId;

	if ( currentSessionState.serverHydrationDisabled && ! remoteChatMatches && ! sessionMatches ) {
		return false;
	}

	if ( currentSessionState.messages.length === 0 ) {
		return true;
	}

	if ( remoteChatMatches || sessionMatches ) {
		return true;
	}

	if ( currentSessionState.input.trim() ) {
		return false;
	}

	if ( currentSessionState.remoteChatId === undefined ) {
		return true;
	}

	return hydratedSessionState.lastUpdated > currentSessionState.lastUpdated;
};

interface PreviewWebviewTag extends HTMLElement {
	loadURL( url: string ): Promise< void >;
	reload(): void;
	getURL(): string;
	getTitle(): string;
}

interface PreviewWebviewTitleEvent extends Event {
	title?: string;
}

interface DollyPreviewPanelProps {
	selectedSite: SyncSite;
	previewState: DollyPreviewState;
	previewUrl?: string;
	onClose: () => void;
	onRefresh: () => void;
	onUpdateState: ( state: Partial< DollyPreviewState > ) => void;
}

const DollyPreviewPanelPortal = ( { children }: { children: React.ReactNode } ) => {
	const [ portalRoot, setPortalRoot ] = useState< HTMLElement | null >( () =>
		typeof document === 'undefined'
			? null
			: document.getElementById( 'assistant-preview-panel-root' )
	);

	useEffect( () => {
		if ( typeof document === 'undefined' ) {
			return;
		}
		setPortalRoot( document.getElementById( 'assistant-preview-panel-root' ) );
	}, [] );

	if ( ! portalRoot ) {
		return <>{ children }</>;
	}

	return createPortal( children, portalRoot );
};

function DollyPreviewPanel( {
	selectedSite,
	previewState,
	previewUrl,
	onClose,
	onRefresh,
	onUpdateState,
}: DollyPreviewPanelProps ) {
	const [ width, setWidth ] = useState( DOLLY_PREVIEW_PANEL_DEFAULT_WIDTH );
	const title = previewState.pageTitle || previewState.title || __( 'Site preview' );
	const displayUrl = previewState.currentUrl || previewUrl || selectedSite.url;

	const handleResizeStart = ( event: React.PointerEvent< HTMLButtonElement > ) => {
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = width;
		const maxWidth = Math.min( DOLLY_PREVIEW_PANEL_MAX_WIDTH, window.innerWidth * 0.65 );

		const handlePointerMove = ( pointerEvent: PointerEvent ) => {
			const nextWidth = startWidth + startX - pointerEvent.clientX;
			setWidth( Math.max( DOLLY_PREVIEW_PANEL_MIN_WIDTH, Math.min( maxWidth, nextWidth ) ) );
		};

		const handlePointerUp = () => {
			window.removeEventListener( 'pointermove', handlePointerMove );
			window.removeEventListener( 'pointerup', handlePointerUp );
		};

		window.addEventListener( 'pointermove', handlePointerMove );
		window.addEventListener( 'pointerup', handlePointerUp );
	};

	return (
		<aside
			className="relative h-full shrink-0 border-l border-a8c-gray-5 bg-white flex flex-col"
			style={ { width } }
			aria-label={ __( 'Assistant site preview' ) }
		>
			<button
				type="button"
				className="absolute left-0 top-0 h-full w-2 -translate-x-1 cursor-col-resize border-0 bg-transparent p-0"
				aria-label={ __( 'Resize site preview' ) }
				aria-orientation="vertical"
				role="separator"
				onPointerDown={ handleResizeStart }
			/>
			<div className="h-12 shrink-0 border-b border-a8c-gray-5 px-3 flex items-center gap-2">
				<div className="min-w-0 flex-1">
					<div className="truncate text-[13px] leading-4 font-medium text-frame-text">
						{ title }
					</div>
					<div className="truncate text-xs leading-4 text-frame-text-secondary">{ displayUrl }</div>
				</div>
				<Button
					variant="icon"
					tooltipText={ __( 'Reload preview' ) }
					disabled={ ! previewUrl }
					onClick={ onRefresh }
					aria-label={ __( 'Reload preview' ) }
				>
					<Icon icon={ redo } size={ 18 } />
				</Button>
				<Button
					variant="icon"
					tooltipText={ __( 'Open in browser' ) }
					disabled={ ! previewUrl }
					onClick={ () => getIpcApi().openURL( previewState.currentUrl || previewUrl || '' ) }
					aria-label={ __( 'Open in browser' ) }
				>
					<Icon icon={ external } size={ 18 } />
				</Button>
				<Button
					variant="icon"
					tooltipText={ __( 'Close preview' ) }
					onClick={ onClose }
					aria-label={ __( 'Close preview' ) }
				>
					<Icon icon={ closeSmall } size={ 20 } />
				</Button>
			</div>
			<div className="relative min-h-0 flex-1 bg-a8c-gray-0">
				{ previewUrl ? (
					isElectron() ? (
						<DollyPreviewWebview
							key={ selectedSite.id }
							url={ previewUrl }
							reloadNonce={ previewState.reloadNonce }
							onUpdateState={ onUpdateState }
						/>
					) : (
						<iframe
							key={ `${ previewUrl }#${ previewState.reloadNonce }` }
							className="absolute inset-0 h-full w-full border-0 bg-white"
							src={ previewUrl }
							title={ `${ selectedSite.name } preview` }
							onLoad={ () =>
								onUpdateState( {
									currentUrl: previewUrl,
									isLoading: false,
								} )
							}
						/>
					)
				) : (
					<div className="h-full p-6 flex flex-col items-center justify-center gap-3 text-center">
						<Icon icon={ desktop } size={ 32 } className="fill-frame-text-secondary" />
						<div>
							<div className="text-sm font-medium text-frame-text">
								{ __( 'Preview needs a valid WordPress.com site URL.' ) }
							</div>
							<div className="mt-1 text-xs text-frame-text-secondary">
								{ __( 'Dolly previews the live WordPress.com site that it can manage.' ) }
							</div>
						</div>
					</div>
				) }
				{ previewState.isLoading && previewUrl ? (
					<div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-a8c-gray-5">
						<div className="h-full w-1/2 animate-pulse bg-frame-theme" />
					</div>
				) : null }
			</div>
		</aside>
	);
}

function DollyPreviewWebview( {
	url,
	reloadNonce,
	onUpdateState,
}: {
	url: string;
	reloadNonce: number;
	onUpdateState: ( state: Partial< DollyPreviewState > ) => void;
} ) {
	const ref = useRef< HTMLElement | null >( null );
	const [ ready, setReady ] = useState( false );
	const [ initialNav ] = useState( () => ( { url, reloadNonce } ) );

	useEffect( () => {
		const webview = ref.current as PreviewWebviewTag | null;
		if ( ! webview ) {
			return;
		}

		const updateFromWebview = ( nextState: Partial< DollyPreviewState > = {} ) => {
			onUpdateState( {
				currentUrl: webview.getURL?.() || url,
				pageTitle: webview.getTitle?.() || undefined,
				...nextState,
			} );
		};

		const handleDomReady = () => {
			setReady( true );
			updateFromWebview();
		};
		const handleStartLoading = () => onUpdateState( { isLoading: true } );
		const handleStopLoading = () => updateFromWebview( { isLoading: false } );
		const handleTitleUpdated = ( event: Event ) => {
			const titleEvent = event as PreviewWebviewTitleEvent;
			onUpdateState( { pageTitle: titleEvent.title } );
		};

		webview.addEventListener( 'dom-ready', handleDomReady );
		webview.addEventListener( 'did-start-loading', handleStartLoading );
		webview.addEventListener( 'did-stop-loading', handleStopLoading );
		webview.addEventListener( 'did-navigate', handleStopLoading );
		webview.addEventListener( 'did-navigate-in-page', handleStopLoading );
		webview.addEventListener( 'page-title-updated', handleTitleUpdated );
		return () => {
			webview.removeEventListener( 'dom-ready', handleDomReady );
			webview.removeEventListener( 'did-start-loading', handleStartLoading );
			webview.removeEventListener( 'did-stop-loading', handleStopLoading );
			webview.removeEventListener( 'did-navigate', handleStopLoading );
			webview.removeEventListener( 'did-navigate-in-page', handleStopLoading );
			webview.removeEventListener( 'page-title-updated', handleTitleUpdated );
		};
	}, [ onUpdateState, url ] );

	useEffect( () => {
		if ( ! ready ) {
			return;
		}
		const webview = ref.current as PreviewWebviewTag | null;
		if ( ! webview ) {
			return;
		}
		if ( url === initialNav.url && reloadNonce === initialNav.reloadNonce ) {
			return;
		}
		onUpdateState( { isLoading: true } );
		webview.loadURL( url ).catch( () => onUpdateState( { isLoading: false } ) );
	}, [ initialNav.reloadNonce, initialNav.url, onUpdateState, ready, reloadNonce, url ] );

	return (
		<webview
			ref={ ref }
			src={ initialNav.url }
			className="absolute inset-0 h-full w-full border-0 bg-white"
			allowpopups="true"
			partition="persist:site-preview"
		/>
	);
}

// Telex icon with red/orange background
const TelexIcon = () => (
	<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
		<rect width="24" height="24" rx="2" fill="rgb(229, 74, 39)" />
		<g transform="translate(5, 5)" clipPath="url(#clip0_telex_icon)">
			<path
				d="M13.7035 6.58213L10.8309 5.59124C9.69491 5.20089 8.79911 4.30509 8.40876 3.16908L7.41787 0.296515C7.28275 -0.0988382 6.71725 -0.0988382 6.58213 0.296515L5.59124 3.16908C5.20089 4.30509 4.30509 5.20089 3.16908 5.59124L0.296515 6.58213C-0.0988382 6.71725 -0.0988382 7.28275 0.296515 7.41787L3.16908 8.40876C4.30509 8.79911 5.20089 9.69491 5.59124 10.8309L6.58213 13.7035C6.71725 14.0988 7.28275 14.0988 7.41787 13.7035L8.40876 10.8309C8.79911 9.69491 9.69491 8.79911 10.8309 8.40876L13.7035 7.41787C14.0988 7.28275 14.0988 6.71725 13.7035 6.58213ZM10.3505 7.21269L8.91421 7.70813C8.3437 7.90331 7.8983 8.35371 7.70313 8.91921L7.20768 10.3555C7.13762 10.5557 6.85737 10.5557 6.79231 10.3555L6.29687 8.91921C6.1017 8.3487 5.6513 7.90331 5.08579 7.70813L3.64951 7.21269C3.44933 7.14263 3.44933 6.86238 3.64951 6.79232L5.08579 6.29687C5.6563 6.1017 6.1017 5.6513 6.29687 5.08579L6.79231 3.64951C6.86238 3.44933 7.14263 3.44933 7.20768 3.64951L7.70313 5.08579C7.8983 5.6563 8.3487 6.1017 8.91421 6.29687L10.3505 6.79232C10.5507 6.86238 10.5507 7.14263 10.3505 7.21269Z"
				fill="currentColor"
			/>
		</g>
		<defs>
			<clipPath id="clip0_telex_icon">
				<rect width="14" height="14" fill="white" />
			</clipPath>
		</defs>
	</svg>
);

interface ContentTabAssistantProps {
	selectedSite: SiteDetails;
}

const ErrorNotice = ( {
	submitPrompt,
	messageContent,
}: {
	submitPrompt: ( messageToSend: string, isRetry?: boolean ) => void;
	messageContent: string;
} ) => {
	const { __ } = useI18n();

	return (
		<div className="text-frame-text-secondary flex justify-end py-2 text-xs">
			{ createInterpolateElement(
				__( "Oops! We couldn't get a response from the assistant. <a>Try again</a>" ),
				{
					a: (
						<Button
							variant="link"
							onClick={ () => submitPrompt( messageContent, true ) }
							className="text-xs !ml-1"
						/>
					),
				}
			) }
		</div>
	);
};

const DollyChatRatingAction = ( {
	instanceId,
	messageApiId,
	feedbackReceived,
}: {
	instanceId: string;
	messageApiId: number;
	feedbackReceived: boolean;
} ) => (
	<ChatRating
		instanceId={ instanceId }
		messageApiId={ messageApiId }
		feedbackReceived={ feedbackReceived }
	/>
);

const UsageLimitReached = () => {
	const { data: assistantQuota } = useGetAssistantQuota();
	const daysUntilReset = assistantQuota?.daysUntilReset ?? 0;

	// Determine if the reset is today
	const resetMessage =
		daysUntilReset <= 0
			? __( "You've reached your <a>usage limit</a> for this month. Your limit will reset today." )
			: sprintf(
					_n(
						"You've reached your <a>usage limit</a> for this month. Your limit will reset in %d day.",
						"You've reached your <a>usage limit</a> for this month. Your limit will reset in %d days.",
						daysUntilReset
					),
					daysUntilReset
			  );

	return (
		<div className="text-center h-12 px-2 pt-6 text-frame-text-secondary">
			{ createInterpolateElement( resetMessage, {
				a: <Button onClick={ () => getIpcApi().showUserSettings( 'account' ) } variant="link" />,
			} ) }
		</div>
	);
};

const OfflineModeView = () => {
	const offlineMessage = __( 'The AI assistant requires an internet connection.' );

	return (
		<div className="flex items-center justify-center h-12 px-2 pt-4 text-frame-text-secondary gap-1">
			<Icon className="m-1 fill-frame-text-secondary" size={ 24 } icon={ offlineIcon } />
			<span className="text-[13px] leading-[16px]">{ offlineMessage }</span>
		</div>
	);
};

const LastMessage = forwardRef<
	HTMLDivElement,
	React.PropsWithChildren< {
		instanceId: string;
		message: MessageType;
		showThinking: boolean;
		siteId: string;
	} >
>( ( { children, instanceId, message, showThinking, siteId }, ref ) => {
	const [ isInitialRender, setIsInitialRender ] = useState( true );

	useEffect( () => {
		if ( isInitialRender ) {
			setIsInitialRender( false );
		}
	}, [ isInitialRender ] );

	const thinkingAnimation = {
		initial: { opacity: 0, y: 20 },
		animate: { opacity: 1, y: 0 },
		exit: { opacity: 0, y: -20 },
	};
	const messageAnimation = {
		initial: { opacity: 0, y: 20 },
		animate: { opacity: 1, y: 0 },
	};

	return (
		<ChatMessage
			ref={ ref }
			id={ `message-chat-${ message.id }` }
			message={ message }
			siteId={ siteId }
			instanceId={ instanceId }
		>
			<AnimatePresence mode="wait">
				{ showThinking ? (
					<motion.div
						key="thinking"
						initial={ isInitialRender ? 'animate' : 'initial' }
						animate="animate"
						exit="exit"
						variants={ thinkingAnimation }
						transition={ { duration: 0.3 } }
					>
						<MessageThinking />
					</motion.div>
				) : (
					<motion.div
						key="content"
						initial={ isInitialRender ? 'animate' : 'initial' }
						variants={ messageAnimation }
						transition={ { duration: 0.3 } }
						animate="animate"
					>
						<MarkDownWithCode
							message={ message }
							siteId={ siteId }
							instanceId={ instanceId }
							content={ message.content }
						/>
						{ children }
					</motion.div>
				) }
			</AnimatePresence>
		</ChatMessage>
	);
} );

interface AuthenticatedViewProps {
	messages: MessageType[];
	instanceId: string;
	isAssistantThinking: boolean;
	siteId: string;
	submitPrompt: ( messageToSend: string, isRetry?: boolean ) => void;
	wrapperRef: React.RefObject< HTMLDivElement >;
}

const AuthenticatedView = memo(
	( {
		messages,
		instanceId,
		isAssistantThinking,
		siteId,
		submitPrompt,
		wrapperRef,
	}: AuthenticatedViewProps ) => {
		const lastMessageRef = useRef< HTMLDivElement >( null );
		const [ showThinking, setShowThinking ] = useState( isAssistantThinking );
		const lastMessage = useMemo(
			() =>
				showThinking
					? ( { role: 'assistant', id: -1, createdAt: 0 } as MessageType )
					: messages[ messages.length - 1 ],
			[ messages, showThinking ]
		);
		const messagesToRender =
			messages[ messages.length - 1 ]?.role === 'assistant' ? messages.slice( 0, -1 ) : messages;
		const showLastMessage = lastMessage?.role === 'assistant';
		const lastMessageRole = messages[ messages.length - 1 ]?.role;
		const previousMessagesLength = useRef( messages.length );
		const isInitialRenderRef = useRef( true );

		// This effect may run twice when the component is mounted, which makes the viewport scroll
		// to the wrong position. This happens because the app runs in React strict mode, meaning
		// it only affects the development environment. For more details, see
		// https://github.com/Automattic/studio/pull/788#issuecomment-2586644007
		useEffect( () => {
			if ( ! messages.length ) {
				return;
			}

			let timer: NodeJS.Timeout;
			// Scroll to the end of the messages when the tab is opened or site ID changes
			if ( isInitialRenderRef.current ) {
				wrapperRef.current?.scrollIntoView( { block: 'end', behavior: 'instant' } );
				isInitialRenderRef.current = false;
			}
			// Scroll when a new message is added
			else if ( messages.length > previousMessagesLength.current || showLastMessage ) {
				// Scroll to the beginning of last message received from the assistant
				if ( showLastMessage ) {
					timer = setTimeout( () => {
						if ( lastMessageRef.current ) {
							lastMessageRef.current.scrollIntoView( { block: 'start', behavior: 'smooth' } );
						}
					}, 400 );
				}
				// For user messages, scroll to the end of the messages
				else {
					wrapperRef.current?.scrollIntoView( { block: 'end', behavior: 'smooth' } );
				}
			}

			previousMessagesLength.current = messages.length;

			return () => clearTimeout( timer );
		}, [ messages.length, showLastMessage, wrapperRef ] );

		useEffect( () => {
			let timer: NodeJS.Timeout;
			if ( lastMessageRole === 'assistant' ) {
				setShowThinking( false );
			} else if ( isAssistantThinking ) {
				timer = setTimeout( () => setShowThinking( true ), MIMIC_CONVERSATION_DELAY );
			} else {
				setShowThinking( false );
			}
			return () => clearTimeout( timer );
		}, [ isAssistantThinking, lastMessageRole ] );

		const RenderMessage = useCallback(
			( { message }: { message: MessageType } ) => (
				<>
					<ChatMessage
						id={ `message-chat-${ message.id }` }
						message={ message }
						siteId={ siteId }
						instanceId={ instanceId }
					>
						{ message.content }
					</ChatMessage>
					{ message.failedMessage && (
						<ErrorNotice submitPrompt={ submitPrompt } messageContent={ message.content } />
					) }
				</>
			),
			[ submitPrompt, siteId, instanceId ]
		);

		if ( messages.length === 0 ) {
			return null;
		}
		return (
			<>
				{ messagesToRender.map( ( message ) => (
					<RenderMessage key={ message.id } message={ message } />
				) ) }
				{ showLastMessage && (
					<LastMessage
						instanceId={ instanceId }
						message={ lastMessage }
						ref={ lastMessageRef }
						showThinking={ showThinking }
						siteId={ siteId }
					>
						<div className="flex justify-end">
							{ !! lastMessage.messageApiId && (
								<ChatRating
									instanceId={ instanceId }
									messageApiId={ lastMessage.messageApiId }
									feedbackReceived={ !! lastMessage.feedbackReceived }
								/>
							) }
						</div>
					</LastMessage>
				) }
			</>
		);
	}
);

const UnauthenticatedView = ( { onAuthenticate }: { onAuthenticate: () => void } ) => (
	<ChatMessage
		id="message-unauthenticated"
		className="w-full"
		message={ { role: 'user' } as MessageType }
		isUnauthenticated={ true }
		instanceId=""
	>
		<div data-testid="unauthenticated-header" className="mb-3 a8c-label-semibold">
			{ __( 'Hold up!' ) }
		</div>
		<div className="mb-1">
			{ __( 'You need to log in to your WordPress.com account to use the assistant.' ) }
		</div>
		<div className="mb-1">
			{ createInterpolateElement(
				__( "If you don't have an account yet, <a>create one for free</a>." ),
				{
					a: <Button variant="link" onClick={ () => getIpcApi().authenticate( true ) } />,
				}
			) }
		</div>
		<div className="mb-3">
			{ sprintf(
				__( 'Every account gets %d prompts included for free each month.' ),
				LIMIT_OF_PROMPTS_PER_USER
			) }
		</div>
		<Button variant="primary" onClick={ onAuthenticate }>
			{ __( 'Log in to WordPress.com' ) }
			<ArrowIcon />
		</Button>
	</ChatMessage>
);

const DollyEmptyView = ( {
	onSuggestionClick: _onSuggestionClick,
}: {
	onSuggestionClick?: unknown;
} ) => (
	<div className="flex h-full items-end px-4 py-3 text-sm text-frame-text-secondary">
		{ __( 'Ask Dolly about this WordPress.com site.' ) }
	</div>
);

export function ContentTabAssistant( { selectedSite }: ContentTabAssistantProps ) {
	const { enableStudioCodeUi } = useFeatureFlags();

	if ( enableStudioCodeUi ) {
		return <StudioCodeChat selectedSite={ selectedSite } />;
	}

	return <WpcomAssistant selectedSite={ selectedSite } />;
}

interface WpcomSiteAssistantProps {
	selectedWpcomSite: SyncSite;
}

export function WpcomSiteAssistant( { selectedWpcomSite }: WpcomSiteAssistantProps ) {
	const { isAuthenticated, authenticate, user, client } = useAuth();
	const isOffline = useOffline();
	const sessionCacheKey = createWpcomSiteAssistantSessionKey( selectedWpcomSite.id );
	const initialSessionState = getWpcomSiteAssistantSessionState(
		sessionCacheKey,
		selectedWpcomSite
	);
	const [ input, setInput ] = useState( initialSessionState.input );
	const [ messages, setMessages ] = useState< MessageType[] >( initialSessionState.messages );
	const [ sessionId, setSessionId ] = useState< string | undefined >(
		initialSessionState.sessionId
	);
	const [ isAssistantThinking, setIsAssistantThinking ] = useState( false );
	const [ activeWpcomSite, setActiveWpcomSite ] = useState< SyncSite >(
		initialSessionState.activeWpcomSite
	);
	const [ previewState, setPreviewState ] = useState< DollyPreviewState >(
		initialSessionState.previewState
	);
	const [ pendingImages, setPendingImages ] = useState< DollyPendingImage[] >( [] );
	const [ imageUploadError, setImageUploadError ] = useState< string | undefined >();
	const [ optimisticMessageImages, setOptimisticMessageImages ] = useState<
		Record< string, DollyMessageImageAttachment >
	>( {} );
	const selectionRevisionRef = useRef( 0 );
	const isMountedRef = useRef( true );
	const imageUploaderRef = useRef< ImageUploaderHandle >( null );
	const dollyDropZoneRef = useRef< HTMLDivElement >( null );
	const pendingImagesRef = useRef< DollyPendingImage[] >( pendingImages );
	const dollyRequestAbortControllerRef = useRef< AbortController | undefined >( undefined );
	const activeWpcomSiteRef = useRef< SyncSite >( activeWpcomSite );
	const selectedWpcomSiteIdRef = useRef( selectedWpcomSite.id );
	const conversationIdRef = useRef( initialSessionState.id );
	const remoteChatIdRef = useRef( initialSessionState.remoteChatId );
	const serverHydrationDisabledRef = useRef(
		Boolean( initialSessionState.serverHydrationDisabled )
	);
	const isAssistantThinkingRef = useRef( isAssistantThinking );
	const hydratedSessionKeysRef = useRef( new Set< string >() );
	const instanceId = user?.id
		? `dolly_${ user.id }_wpcom_${ activeWpcomSite.id }`
		: `dolly_wpcom_${ activeWpcomSite.id }`;
	const previewUrl = useMemo(
		() => normalizePreviewUrl( activeWpcomSite.url, previewState.pathOrUrl ),
		[ activeWpcomSite.url, previewState.pathOrUrl ]
	);
	const siteAssociation = useMemo(
		() => createWpcomOnlySiteAssociationContext( activeWpcomSite ),
		[ activeWpcomSite ]
	);
	const previewContext = useMemo(
		() => createPreviewContext( activeWpcomSite, previewState, previewUrl ),
		[ activeWpcomSite, previewState, previewUrl ]
	);
	const hasFailedMessage = messages.some( ( msg ) => msg.failedMessage );
	const failedMessageContent = messages.find( ( msg ) => msg.failedMessage )?.content;
	const lastMessage = messages.length === 0 ? undefined : messages[ messages.length - 1 ];

	const updatePreviewState = useCallback( ( nextState: Partial< DollyPreviewState > ) => {
		setPreviewState( ( currentState ) => ( { ...currentState, ...nextState } ) );
	}, [] );

	const clearPendingImages = useCallback( () => {
		setPendingImages( ( currentImages ) => {
			revokeDollyPendingImageUrls( currentImages );
			return [];
		} );
		setImageUploadError( undefined );
	}, [] );

	const removePendingImage = useCallback( ( image: UploadedImage ) => {
		setPendingImages( ( currentImages ) => {
			const removedImage = currentImages.find( ( currentImage ) => currentImage.id === image.id );
			if ( removedImage ) {
				revokeDollyPendingImageUrls( [ removedImage ] );
			}
			return currentImages.filter( ( currentImage ) => currentImage.id !== image.id );
		} );
	}, [] );

	const addPendingImages = useCallback(
		( files: File[] ) => {
			const validFiles = files.filter( ( file ) => DOLLY_IMAGE_FILE_TYPES.includes( file.type ) );
			const validSizedFiles = validFiles.filter(
				( file ) => file.size <= DOLLY_IMAGE_MAX_FILE_SIZE
			);
			const remainingSlots = Math.max( DOLLY_IMAGE_MAX_FILES - pendingImages.length, 0 );
			const filesToAdd = validSizedFiles.slice( 0, remainingSlots );

			if ( files.length !== validFiles.length ) {
				setImageUploadError( __( 'Only JPEG, PNG, GIF, or WebP images can be attached.' ) );
			} else if ( validFiles.length !== validSizedFiles.length ) {
				setImageUploadError( __( 'Images must be 10 MB or smaller.' ) );
			} else if ( validSizedFiles.length > filesToAdd.length ) {
				setImageUploadError(
					sprintf( __( 'You can attach up to %d images at a time.' ), DOLLY_IMAGE_MAX_FILES )
				);
			} else if ( filesToAdd.length > 0 ) {
				setImageUploadError( undefined );
			}

			if ( filesToAdd.length === 0 ) {
				return;
			}

			const nextImages = filesToAdd.map( ( file ) => ( {
				id: crypto.randomUUID(),
				url: URL.createObjectURL( file ),
				name: file.name,
				title: file.name,
				mime_type: file.type,
				file,
			} ) );

			setPendingImages( ( currentImages ) => [ ...currentImages, ...nextImages ] );

			void Promise.all(
				nextImages.map( async ( image ) => ( {
					sourceId: image.id,
					dataUrl: await readFileAsDataUrl( image.file ),
				} ) )
			)
				.then( ( imageDataUrls ) => {
					if ( ! isMountedRef.current ) {
						return;
					}
					const dataUrlsByImageId = new Map< string, string >(
						imageDataUrls.map( ( image ) => [ image.sourceId, image.dataUrl ] )
					);
					setPendingImages( ( currentImages ) =>
						currentImages.map( ( currentImage ) => ( {
							...currentImage,
							dataUrl: dataUrlsByImageId.get( currentImage.id ) ?? currentImage.dataUrl,
						} ) )
					);
				} )
				.catch( () => {
					if ( isMountedRef.current ) {
						setImageUploadError( __( 'Unable to prepare image preview.' ) );
					}
				} );
		},
		[ pendingImages.length ]
	);

	useEffect( () => {
		activeWpcomSiteRef.current = activeWpcomSite;
	}, [ activeWpcomSite ] );

	useEffect( () => {
		pendingImagesRef.current = pendingImages;
	}, [ pendingImages ] );

	useEffect( () => () => revokeDollyPendingImageUrls( pendingImagesRef.current ), [] );

	useEffect( () => {
		isAssistantThinkingRef.current = isAssistantThinking;
	}, [ isAssistantThinking ] );

	useEffect( () => {
		if ( selectedWpcomSiteIdRef.current !== selectedWpcomSite.id ) {
			return;
		}

		const sessionState: WpcomSiteAssistantSessionState = {
			id: conversationIdRef.current,
			key: {
				siteId: selectedWpcomSite.id,
				agentId: DOLLY_AGENT_ID,
			},
			remoteChatId: remoteChatIdRef.current,
			serverHydrationDisabled: serverHydrationDisabledRef.current,
			input,
			messages,
			sessionId,
			activeWpcomSite,
			previewState,
			lastUpdated: Date.now(),
		};
		wpcomSiteAssistantSessionStateCache.set( sessionCacheKey, sessionState );
		persistWpcomSiteAssistantSessionStateCache();
	}, [
		activeWpcomSite,
		input,
		messages,
		previewState,
		selectedWpcomSite.id,
		sessionCacheKey,
		sessionId,
	] );

	useEffect( () => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;
			dollyRequestAbortControllerRef.current?.abort();
			dollyRequestAbortControllerRef.current = undefined;
		};
	}, [] );

	useEffect( () => {
		if ( selectedWpcomSiteIdRef.current === selectedWpcomSite.id ) {
			return;
		}

		selectionRevisionRef.current += 1;
		dollyRequestAbortControllerRef.current?.abort();
		dollyRequestAbortControllerRef.current = undefined;
		selectedWpcomSiteIdRef.current = selectedWpcomSite.id;
		const nextSessionState = getWpcomSiteAssistantSessionState(
			sessionCacheKey,
			selectedWpcomSite
		);
		conversationIdRef.current = nextSessionState.id;
		remoteChatIdRef.current = nextSessionState.remoteChatId;
		serverHydrationDisabledRef.current = Boolean( nextSessionState.serverHydrationDisabled );
		setActiveWpcomSite( nextSessionState.activeWpcomSite );
		setInput( nextSessionState.input );
		setMessages( nextSessionState.messages );
		setOptimisticMessageImages( {} );
		setSessionId( nextSessionState.sessionId );
		setIsAssistantThinking( false );
		setPreviewState( nextSessionState.previewState );
	}, [ selectedWpcomSite, sessionCacheKey ] );

	useEffect( () => {
		if (
			! isAuthenticated ||
			isOffline ||
			! client ||
			typeof ( client.req as { get?: unknown } ).get !== 'function' ||
			hydratedSessionKeysRef.current.has( sessionCacheKey )
		) {
			return;
		}

		hydratedSessionKeysRef.current.add( sessionCacheKey );
		let isCurrentHydration = true;

		void ( async () => {
			try {
				const cachedSessionState =
					wpcomSiteAssistantSessionStateCache.get( sessionCacheKey ) ??
					getWpcomSiteAssistantSessionState( sessionCacheKey, selectedWpcomSite );
				const hydratedSessionState = await hydrateWpcomSiteAssistantSessionState(
					client,
					selectedWpcomSite,
					cachedSessionState.sessionId
				);

				if (
					! hydratedSessionState ||
					! isCurrentHydration ||
					! isMountedRef.current ||
					isAssistantThinkingRef.current
				) {
					return;
				}

				const currentSessionState =
					wpcomSiteAssistantSessionStateCache.get( sessionCacheKey ) ??
					getWpcomSiteAssistantSessionState( sessionCacheKey, selectedWpcomSite );
				if (
					! shouldApplyWpcomSiteAssistantHydration( currentSessionState, hydratedSessionState )
				) {
					return;
				}

				const nextSessionState: WpcomSiteAssistantSessionState = {
					...hydratedSessionState,
					input: currentSessionState.input,
					activeWpcomSite: currentSessionState.activeWpcomSite,
					previewState: currentSessionState.previewState,
					serverHydrationDisabled: false,
				};

				conversationIdRef.current = nextSessionState.id;
				remoteChatIdRef.current = nextSessionState.remoteChatId;
				serverHydrationDisabledRef.current = false;
				wpcomSiteAssistantSessionStateCache.set( sessionCacheKey, nextSessionState );
				persistWpcomSiteAssistantSessionStateCache();
				setActiveWpcomSite( nextSessionState.activeWpcomSite );
				setInput( nextSessionState.input );
				setMessages( nextSessionState.messages );
				setOptimisticMessageImages( {} );
				setSessionId( nextSessionState.sessionId );
				setPreviewState( nextSessionState.previewState );
			} catch ( error ) {
				console.error( error );
			}
		} )();

		return () => {
			isCurrentHydration = false;
		};
	}, [ client, isAuthenticated, isOffline, selectedWpcomSite, sessionCacheKey ] );

	const openPreview = useCallback(
		( pathOrUrl = '/', title?: string, { forceReload = false }: OpenPreviewOptions = {} ) => {
			setPreviewState( ( currentState ) => {
				const shouldLoad =
					forceReload || ! currentState.open || currentState.pathOrUrl !== pathOrUrl;

				return {
					...currentState,
					open: true,
					pathOrUrl,
					title,
					pageTitle: shouldLoad ? undefined : currentState.pageTitle,
					currentUrl: shouldLoad ? undefined : currentState.currentUrl,
					isLoading: shouldLoad ? true : currentState.isLoading,
					reloadNonce: forceReload ? currentState.reloadNonce + 1 : currentState.reloadNonce,
				};
			} );
		},
		[]
	);

	const getDollyPreviewAbilities = useCallback(
		async () =>
			createDollyPreviewAbilities( {
				activeWpcomSite,
				previewState,
				openPreview,
			} ),
		[ activeWpcomSite, openPreview, previewState ]
	);
	const dollyToolProvider = useClientAbilities( getDollyPreviewAbilities );

	const syncBackendActiveWpcomSite = useCallback(
		async ( backendSelectedSiteId: number | undefined, requestSelectionRevision: number ) => {
			if (
				! client ||
				! backendSelectedSiteId ||
				activeWpcomSiteRef.current.id === backendSelectedSiteId ||
				selectionRevisionRef.current !== requestSelectionRevision
			) {
				return;
			}

			const nextSite = await fetchDollySite( client, backendSelectedSiteId );
			if (
				nextSite &&
				isMountedRef.current &&
				selectionRevisionRef.current === requestSelectionRevision
			) {
				setActiveWpcomSite( nextSite );
			}
		},
		[ client ]
	);

	const submitPrompt = useCallback(
		( chatMessage: string, isRetry?: boolean ) => {
			const trimmedMessage = chatMessage.trim();
			const imagesToSend = isRetry ? [] : pendingImages;
			if (
				( ! trimmedMessage && imagesToSend.length === 0 ) ||
				! client ||
				isAssistantThinking ||
				selectedWpcomSiteIdRef.current !== selectedWpcomSite.id
			) {
				return;
			}

			if ( ! isRetry ) {
				setInput( '' );
			}

			const messageToSend =
				trimmedMessage ||
				( imagesToSend.length > 0 ? createDollyImagePrompt( imagesToSend.length ) : '' );
			const newMessageId = isRetry ? messages.length - 1 : messages.length;
			const optimisticImagesPromise = createDollyPendingVisibleImages( imagesToSend );
			const abortController = new AbortController();
			dollyRequestAbortControllerRef.current = abortController;

			if ( ! isRetry && imagesToSend.length > 0 ) {
				setPendingImages( [] );
				setImageUploadError( undefined );
				revokeDollyPendingImageUrls( imagesToSend );
			}

			setIsAssistantThinking( true );
			const requestSelectionRevision = selectionRevisionRef.current;
			const isCurrentTurn = () =>
				isMountedRef.current && selectionRevisionRef.current === requestSelectionRevision;

			void ( async () => {
				let optimisticMessage: MessageType | undefined;
				try {
					const optimisticImages = await optimisticImagesPromise;
					const nextOptimisticMessage = generateMessage( messageToSend, 'user', newMessageId );
					optimisticMessage = nextOptimisticMessage;
					if ( optimisticImages.length > 0 ) {
						setOptimisticMessageImages( ( currentImages ) => ( {
							...currentImages,
							[ nextOptimisticMessage.id ?? nextOptimisticMessage.createdAt ]: {
								text: messageToSend,
								images: optimisticImages,
							},
						} ) );
					}
					setMessages( ( currentMessages ) => {
						if ( ! isRetry ) {
							return [
								...currentMessages.map( ( currentMessage ) => ( {
									...currentMessage,
									failedMessage: false,
								} ) ),
								nextOptimisticMessage,
							];
						}

						return currentMessages.map( ( currentMessage ) =>
							currentMessage.id === nextOptimisticMessage.id
								? { ...nextOptimisticMessage, failedMessage: false }
								: currentMessage
						);
					} );

					const uploadedImages = await uploadDollyImages(
						activeWpcomSite.id,
						imagesToSend,
						abortController.signal
					);
					if ( uploadedImages.length > 0 ) {
						const uploadedVisibleImages = uploadedImages.map( ( image ) => ( {
							name: image.name,
							url: image.url,
						} ) );
						const visibleMessage = createDollyVisibleMessage(
							messageToSend,
							uploadedVisibleImages,
							imagesToSend.length
						);
						setMessages( ( currentMessages ) =>
							currentMessages.map( ( currentMessage ) =>
								currentMessage.id === optimisticMessage?.id
									? { ...currentMessage, content: visibleMessage }
									: currentMessage
							)
						);
						void preloadDollyImageUrls( uploadedVisibleImages ).then( () => {
							if ( ! isCurrentTurn() ) {
								return;
							}

							setOptimisticMessageImages( ( currentImages ) => {
								const optimisticMessageKey = String(
									optimisticMessage?.id ?? optimisticMessage?.createdAt ?? ''
								);
								if ( ! currentImages[ optimisticMessageKey ] ) {
									return currentImages;
								}

								return {
									...currentImages,
									[ optimisticMessageKey ]: {
										text: messageToSend,
										images: uploadedVisibleImages,
									},
								};
							} );
						} );
					}

					const response = await sendDollyMessage( {
						abortSignal: abortController.signal,
						message: messageToSend,
						uploadedImages,
						previewContext,
						siteAssociation,
						selectedSite: activeWpcomSite,
						sessionId,
						siteId: activeWpcomSite.id,
						toolProvider: dollyToolProvider,
					} );

					if ( ! isMountedRef.current ) {
						return;
					}

					if ( response.sessionId ) {
						setSessionId( response.sessionId );
					}

					if ( response.text.trim() ) {
						setMessages( ( currentMessages ) => [
							...currentMessages,
							generateMessage( response.text, 'assistant', currentMessages.length ),
						] );
					}

					void resolveBackendSelectedSiteId( client, response, sessionId ).then(
						( backendSelectedSiteId ) => {
							if ( isCurrentTurn() ) {
								void syncBackendActiveWpcomSite( backendSelectedSiteId, requestSelectionRevision );
							}
						}
					);
				} catch ( error ) {
					if ( ! isMountedRef.current ) {
						return;
					}
					if ( isDollyRequestAbortError( error ) || abortController.signal.aborted ) {
						return;
					}
					console.error( error );
					setImageUploadError( getErrorMessage( error ) );
					if ( ! isRetry ) {
						setInput( chatMessage );
					}
					setMessages( ( currentMessages ) =>
						currentMessages.map( ( currentMessage ) =>
							currentMessage.id === optimisticMessage?.id
								? { ...currentMessage, failedMessage: true }
								: currentMessage
						)
					);
				} finally {
					const isCurrentRequest = dollyRequestAbortControllerRef.current === abortController;
					if ( isCurrentRequest ) {
						dollyRequestAbortControllerRef.current = undefined;
						if ( isMountedRef.current ) {
							setIsAssistantThinking( false );
						}
					}
				}
			} )();
		},
		[
			client,
			dollyToolProvider,
			isAssistantThinking,
			messages.length,
			activeWpcomSite,
			pendingImages,
			previewContext,
			selectedWpcomSite.id,
			sessionId,
			siteAssociation,
			syncBackendActiveWpcomSite,
		]
	);

	const clearConversation = useCallback( () => {
		conversationIdRef.current = createWpcomSiteAssistantConversationId();
		remoteChatIdRef.current = undefined;
		serverHydrationDisabledRef.current = true;
		setInput( '' );
		setMessages( [] );
		setOptimisticMessageImages( {} );
		setSessionId( undefined );
		setActiveWpcomSite( selectedWpcomSite );
		setPreviewState( initialPreviewState() );
		clearPendingImages();
	}, [ clearPendingImages, selectedWpcomSite ] );

	const confirmAndClearConversation = useCallback( async () => {
		if ( localStorage.getItem( 'dontShowClearMessagesWarning' ) === 'true' ) {
			clearConversation();
			return;
		}

		const CLEAR_CONVERSATION_BUTTON_INDEX = 0;
		const CANCEL_BUTTON_INDEX = 1;

		const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
			message: __( 'Are you sure you want to clear the conversation?' ),
			checkboxLabel: __( "Don't show this warning again" ),
			buttons: [ __( 'OK' ), __( 'Cancel' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
		} );

		if ( response === CLEAR_CONVERSATION_BUTTON_INDEX ) {
			if ( checkboxChecked ) {
				localStorage.setItem( 'dontShowClearMessagesWarning', 'true' );
			}

			clearConversation();
		}
	}, [ clearConversation ] );

	const agentticMessages = useMemo< AgentUIProps[ 'messages' ] >(
		() =>
			messages.map( ( message ) => {
				const actions: MessageAction[] = [];
				const messageKey = String( message.id ?? message.createdAt );
				const optimisticImageAttachment = optimisticMessageImages[ messageKey ];

				if ( message.role === 'assistant' && message.messageApiId ) {
					actions.push( {
						type: 'component',
						id: `rating-${ message.messageApiId }`,
						label: __( 'Rate message' ),
						component: DollyChatRatingAction,
						componentProps: {
							instanceId,
							messageApiId: message.messageApiId,
							feedbackReceived: Boolean( message.feedbackReceived ),
						},
					} );
				}

				return {
					id: `${ message.role }-${ message.id ?? message.createdAt }`,
					role: message.role === 'assistant' ? 'agent' : 'user',
					content: [
						{
							type: 'text',
							text: optimisticImageAttachment?.text ?? message.content,
						},
						...( optimisticImageAttachment?.images.length
							? [
									{
										type: 'component' as const,
										component: DollyOptimisticImages,
										componentProps: {
											images: optimisticImageAttachment.images,
										},
									},
							  ]
							: [] ),
					],
					timestamp: message.createdAt,
					archived: false,
					showIcon: message.role === 'assistant',
					disabled: Boolean( message.failedMessage ),
					actions: actions.length ? actions : undefined,
				};
			} ),
		[ instanceId, messages, optimisticMessageImages ]
	);

	const retryFailedMessage = useCallback( () => {
		if ( failedMessageContent ) {
			submitPrompt( failedMessageContent, true );
		}
	}, [ failedMessageContent, submitPrompt ] );

	const interruptDollyRequest = useCallback( () => {
		dollyRequestAbortControllerRef.current?.abort();
	}, [] );

	const dollyNotice = useMemo< AgentticNoticeConfig | undefined >( () => {
		if ( isOffline ) {
			return {
				icon: false,
				message: __( 'The AI assistant requires an internet connection.' ),
				status: 'warning',
				dismissible: false,
			};
		}

		if ( hasFailedMessage ) {
			return {
				message: __( "Oops! We couldn't get a response from Dolly." ),
				action: {
					label: __( 'Try again' ),
					onClick: retryFailedMessage,
				},
				status: 'error',
				dismissible: false,
			};
		}

		if ( imageUploadError ) {
			return {
				message: imageUploadError,
				status: 'error',
				dismissible: true,
				onDismiss: () => setImageUploadError( undefined ),
			};
		}

		return undefined;
	}, [ hasFailedMessage, imageUploadError, isOffline, retryFailedMessage ] );

	const isInputUnavailable = isOffline || ! isAuthenticated || ! client;
	const isInputDisabled = isInputUnavailable && ! isAssistantThinking;
	const isInputActionDisabled = isInputUnavailable || isAssistantThinking;

	const dollyInputActions = useMemo(
		() => [
			{
				id: 'upload-image',
				icon: <Icon icon={ imageIcon } size={ 18 } />,
				onClick: () => imageUploaderRef.current?.openFileDialog(),
				variant: 'ghost' as const,
				disabled: isInputActionDisabled,
				'aria-label': __( 'Upload image' ),
			},
			...( messages.length > 0
				? [
						{
							id: 'clear-conversation',
							icon: <Icon icon={ trash } size={ 18 } />,
							onClick: () => {
								void confirmAndClearConversation();
							},
							variant: 'ghost' as const,
							'aria-label': __( 'Clear conversation' ),
						},
				  ]
				: [] ),
		],
		[ confirmAndClearConversation, isInputActionDisabled, messages.length ]
	);

	const dollyEmptyView = useMemo( () => <DollyEmptyView />, [] );

	const renderConversationReminder = () => {
		if ( isAuthenticated && messages.length > 0 ) {
			return (
				<ClearHistoryReminder lastMessage={ lastMessage } clearConversation={ clearConversation } />
			);
		}
	};

	return (
		<div className="relative h-full min-w-0 flex flex-1 overflow-hidden bg-frame-surface">
			<div className="min-w-0 flex-1 flex flex-col">
				<div className="shrink-0 border-b border-a8c-gray-5 bg-white px-8 py-5 flex items-start gap-4">
					<div className="min-w-0 flex-1">
						<h1 className="m-0 truncate text-xl font-semibold text-frame-text">
							{ activeWpcomSite.name }
						</h1>
						<div className="mt-1 truncate text-sm text-frame-text-secondary">
							{ activeWpcomSite.url }
						</div>
					</div>
					<Button
						variant={ previewState.open ? 'primary' : 'secondary' }
						onClick={ () =>
							previewState.open
								? updatePreviewState( { open: false } )
								: openPreview( previewState.pathOrUrl )
						}
						aria-pressed={ previewState.open }
					>
						<Icon icon={ desktop } size={ 18 } />
						{ previewState.open ? __( 'Hide preview' ) : __( 'Show preview' ) }
					</Button>
				</div>
				<div
					data-testid="assistant-chat"
					ref={ dollyDropZoneRef }
					className={ cx( 'min-h-0 flex-1', ! isAuthenticated && 'overflow-y-auto p-8 pb-2' ) }
				>
					{ isAuthenticated ? (
						<div className="agenttic dolly-agenttic-chat h-full min-h-0">
							<AgentUI.Container
								messages={ agentticMessages }
								isProcessing={ isAssistantThinking }
								error={ null }
								onSubmit={ submitPrompt }
								onStop={ interruptDollyRequest }
								variant="embedded"
								placeholder={ __( 'Ask Dolly about this site' ) }
								notice={ dollyNotice }
								emptyView={ dollyEmptyView }
								messagesPosition="bottom"
								inputValue={ input }
								onInputChange={ setInput }
								maxInputLength={ 10000 }
								thinkingMessage={ __( 'Thinking...' ) }
								className="h-full min-h-0 bg-frame-surface"
							>
								<AgentUI.ConversationView showHeader={ false } className="min-h-0 px-6 py-6">
									<AgentUI.Messages />
									{ messages.length > 0 && (
										<div className="px-4 pb-2 text-frame-text-secondary">
											{ renderConversationReminder() }
										</div>
									) }
									<AgentUI.Footer className="mx-2 bg-white">
										<AgentUI.Notice />
										<ImageUploader
											ref={ imageUploaderRef }
											images={ pendingImages }
											onFilesSelected={ addPendingImages }
											onRemoveImage={ removePendingImage }
											acceptedFileTypes={ DOLLY_IMAGE_FILE_TYPES }
											maxFileSize={ DOLLY_IMAGE_MAX_FILE_SIZE }
											maxFiles={ DOLLY_IMAGE_MAX_FILES }
											dropZoneRef={ dollyDropZoneRef }
											onError={ setImageUploadError }
										/>
										<AgentUI.Input
											disabled={
												isInputDisabled ? true : pendingImages.length > 0 ? false : undefined
											}
											customActions={ dollyInputActions }
											layout="inline"
										/>
									</AgentUI.Footer>
									<div
										data-testid="guidelines-link"
										className="text-frame-text-secondary self-end pt-2 px-2"
									>
										{ __( 'Powered by Dolly.' ) }
									</div>
								</AgentUI.ConversationView>
							</AgentUI.Container>
						</div>
					) : (
						<div className="mt-auto w-full">
							{ isOffline ? (
								<OfflineModeView />
							) : (
								<UnauthenticatedView onAuthenticate={ authenticate } />
							) }
						</div>
					) }
				</div>
			</div>
			{ previewState.open && (
				<DollyPreviewPanelPortal>
					<DollyPreviewPanel
						selectedSite={ activeWpcomSite }
						previewState={ previewState }
						previewUrl={ previewUrl }
						onClose={ () => updatePreviewState( { open: false } ) }
						onRefresh={ () =>
							setPreviewState( ( currentState ) => ( {
								...currentState,
								isLoading: true,
								reloadNonce: currentState.reloadNonce + 1,
							} ) )
						}
						onUpdateState={ updatePreviewState }
					/>
				</DollyPreviewPanelPortal>
			) }
		</div>
	);
}

function WpcomAssistant( { selectedSite }: ContentTabAssistantProps ) {
	const inputRef = useRef< HTMLTextAreaElement >( null );
	const wrapperRef = useRef< HTMLDivElement >( null );
	const dispatch = useAppDispatch();
	const chatInput = useRootSelector( ( state ) =>
		chatSelectors.selectChatInput( state, selectedSite.id )
	);
	const { isAuthenticated, authenticate, user, client } = useAuth();
	const instanceId = user?.id ? `${ user.id }_${ selectedSite.id }` : selectedSite.id;
	const chatApiId = useRootSelector( ( state ) =>
		chatSelectors.selectChatApiId( state, instanceId )
	);
	const messages = useRootSelector( ( state ) =>
		chatSelectors.selectMessages( state, instanceId )
	);
	const isAssistantThinking = useRootSelector( ( state ) =>
		chatSelectors.selectIsLoading( state, instanceId )
	);
	const { data: assistantQuota } = useGetAssistantQuota();
	const userCanSendMessage = assistantQuota?.userCanSendMessage ?? true;
	const isOffline = useOffline();
	const { __ } = useI18n();
	const lastMessage = messages.length === 0 ? undefined : messages[ messages.length - 1 ];
	const hasFailedMessage = messages.some( ( msg ) => msg.failedMessage );
	const { data, isLoading } = useGetWelcomeMessages();

	const { selectedThemeDetails: themeDetails } = useThemeDetails();

	useEffect( () => {
		void dispatch( chatThunks.updateFromSite( { site: selectedSite } ) );
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ dispatch, selectedSite.id ] );

	useEffect( () => {
		if ( themeDetails ) {
			dispatch( chatActions.updateFromTheme( themeDetails ) );
		}
	}, [ dispatch, themeDetails ] );

	const submitPrompt = useCallback(
		( chatMessage: string, isRetry?: boolean ) => {
			if ( ! chatMessage || ! client ) {
				return;
			}

			if ( ! isRetry ) {
				dispatch( chatActions.setChatInput( { siteId: selectedSite.id, input: '' } ) );
			}

			const newMessageId = isRetry ? messages.length - 1 : messages.length;
			const message = generateMessage( chatMessage, 'user', newMessageId, chatApiId );

			void dispatch(
				chatThunks.fetchAssistant( {
					client,
					instanceId,
					isRetry,
					message,
					siteId: selectedSite.id,
				} )
			);
		},
		[ client, dispatch, instanceId, selectedSite.id, messages, chatApiId ]
	);

	const clearConversation = () => {
		dispatch( chatActions.setChatInput( { siteId: selectedSite.id, input: '' } ) );
		dispatch( chatActions.setMessages( { instanceId, messages: [] } ) );
		dispatch( chatActions.setChatApiId( { instanceId, chatApiId: undefined } ) );
	};

	// We should render only one notice at a time in the bottom area
	const renderNotice = () => {
		if ( isOffline ) {
			return <OfflineModeView />;
		} else if ( isAuthenticated && ! userCanSendMessage ) {
			return <UsageLimitReached />;
		} else if ( isAuthenticated ) {
			return (
				<ClearHistoryReminder lastMessage={ lastMessage } clearConversation={ clearConversation } />
			);
		}
	};

	const disabled = isOffline || ! isAuthenticated || ! userCanSendMessage || hasFailedMessage;

	const [ isTelexBannerVisible, setIsTelexBannerVisible ] = useState(
		() => localStorage.getItem( 'dontShowTelexBanner' ) !== 'true'
	);

	const handleDismissBanner = () => {
		localStorage.setItem( 'dontShowTelexBanner', 'true' );
		setIsTelexBannerVisible( false );
	};

	return (
		<div className="relative min-h-full flex flex-col" ref={ wrapperRef }>
			{ isTelexBannerVisible && (
				<div className="bg-frame border border-frame-border rounded-sm m-8 mb-0 p-2 pr-4 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<TelexIcon />
						<span className="text-frame-text">
							{ createInterpolateElement(
								__( 'Build blocks with <button>Telex <ArrowIcon/></button>' ),
								{
									button: (
										<Button
											variant="link"
											onClick={ () => {
												const telexUrl = addUrlParams(
													`https://${ TELEX_HOSTNAME }/`,
													TELEX_UTM_PARAMS
												);
												getIpcApi().openURL( telexUrl );
											} }
										/>
									),
									ArrowIcon: <ArrowIcon />,
								}
							) }
						</span>
					</div>
					<button
						onClick={ handleDismissBanner }
						className="text-frame-text-secondary hover:text-frame-text"
						aria-label={ __( 'Dismiss' ) }
					>
						✕
					</button>
				</div>
			) }
			<div
				data-testid="assistant-chat"
				className={ cx(
					'min-h-full flex-1 overflow-y-auto p-8 pb-2 flex flex-col-reverse',
					! isAuthenticated && 'flex items-start'
				) }
			>
				<div className="mt-auto w-full">
					{ isAuthenticated ? (
						<>
							<WelcomeComponent
								key={ selectedSite.id }
								onExampleClick={ ( prompt ) => {
									submitPrompt( prompt );
									inputRef.current?.focus();
								} }
								showExamplePrompts={ messages.length === 0 }
								messages={ data?.messages ?? [] }
								examplePrompts={ data?.example_prompts ?? [] }
								disabled={ disabled }
								isLoading={ isLoading }
							/>

							<AuthenticatedView
								messages={ messages }
								isAssistantThinking={ isAssistantThinking }
								instanceId={ instanceId }
								siteId={ selectedSite.id }
								submitPrompt={ submitPrompt }
								wrapperRef={ wrapperRef }
							/>
						</>
					) : (
						! isOffline && <UnauthenticatedView onAuthenticate={ authenticate } />
					) }
					{ renderNotice() }
				</div>
			</div>

			<div className="sticky bottom-0 bg-frame/80 backdrop-blur-sm w-full px-8 pt-4 flex items-center">
				<div className="w-full flex flex-col items-center">
					<AIInput
						ref={ inputRef }
						disabled={ disabled }
						input={ chatInput }
						setInput={ ( input ) => {
							dispatch( chatActions.setChatInput( { siteId: selectedSite.id, input } ) );
						} }
						handleSend={ () => {
							submitPrompt( inputRef.current?.value ?? '' );
						} }
						handleKeyDown={ ( event ) => {
							if ( event.key === 'Enter' ) {
								submitPrompt( inputRef.current?.value ?? '' );
							}
						} }
						clearConversation={ clearConversation }
						isAssistantThinking={ isAssistantThinking }
					/>
					<div data-testid="guidelines-link" className="text-frame-text-secondary self-end py-2">
						{ createInterpolateElement( __( 'Powered by experimental AI. <learn_more_link />' ), {
							learn_more_link: (
								<LearnMoreLink docsLinksKey="a8cAiGuidelines" className="!text-frame-theme" />
							),
						} ) }
					</div>
				</div>
			</div>
		</div>
	);
}
