import {
	WORKSPACE_DOLLY_AGENT_ID,
	WORKSPACE_DOLLY_HISTORY_BOT_ID,
	WORKSPACE_DOLLY_HISTORY_CHAT_ITEMS_PER_PAGE,
	WORKSPACE_DOLLY_HISTORY_MAX_PAGES,
	WORKSPACE_DOLLY_HISTORY_SUMMARY_ITEMS_PER_PAGE,
	WORKSPACE_DOLLY_REQUEST_TIMEOUT_MS,
	type WorkspaceDollyConversationState,
	type WorkspaceDollyHistoryChat,
	type WorkspaceDollyHistoryMessage,
	type WorkspaceDollyHistorySummary,
	type WorkspaceDollyTargetDescriptor,
} from 'src/modules/workspaces/lib/dolly/types';
import {
	extractBackendSelectedSiteIdFromRecord,
	getFlexibleNumberValue,
	getStringFromRecord,
	isRecord,
	normalizeDollySessionId,
} from 'src/modules/workspaces/lib/dolly/utils';
import { generateMessage, type Message as MessageType } from 'src/stores/chat-slice';
import type { WPCOM } from 'wpcom/types';

export const createWpcomRequest = < T >(
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

export const wpcomGet = async < T >(
	client: WPCOM,
	path: string,
	timeoutMs = WORKSPACE_DOLLY_REQUEST_TIMEOUT_MS
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

export const extractWorkspaceDollyHistoryEntries = (
	response: unknown
): Record< string, unknown >[] => {
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

export const parseWorkspaceDollyHistoryDate = ( value: unknown ): number | undefined => {
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

export const visibleWorkspaceDollyHistoryMessageText = ( value: string ) => {
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

export const parseWorkspaceDollyHistoryMessage = (
	value: unknown
): WorkspaceDollyHistoryMessage | undefined => {
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
		role === 'user' ? visibleWorkspaceDollyHistoryMessageText( rawContent ) : rawContent.trim();
	if ( ! content ) {
		return undefined;
	}

	return {
		content,
		role,
		createdAt: parseWorkspaceDollyHistoryDate( value.created_at ?? value.createdAt ) ?? Date.now(),
		messageApiId: getFlexibleNumberValue( value, [ 'message_id', 'messageID', 'id' ] ),
	};
};

export const createWorkspaceDollyMessagesFromHistory = (
	messages: WorkspaceDollyHistoryMessage[]
) =>
	messages.map(
		( message, index ) =>
			( {
				...generateMessage( message.content, message.role, index, undefined, message.messageApiId ),
				createdAt: message.createdAt,
			} ) as MessageType
	);

const createWorkspaceDollyHistoryMessageKey = ( message: WorkspaceDollyHistoryMessage ) =>
	message.messageApiId !== undefined
		? `id:${ message.messageApiId }`
		: `fallback:${ message.createdAt }:${ message.role }:${ message.content }`;

const deduplicateWorkspaceDollyHistoryMessages = ( messages: WorkspaceDollyHistoryMessage[] ) => {
	const seenMessages = new Set< string >();
	return [ ...messages ]
		.sort( ( first, second ) => first.createdAt - second.createdAt )
		.filter( ( message ) => {
			const key = createWorkspaceDollyHistoryMessageKey( message );
			if ( seenMessages.has( key ) ) {
				return false;
			}
			seenMessages.add( key );
			return true;
		} );
};

const createWorkspaceDollyHistoryFallbackMessages = ( summary: WorkspaceDollyHistorySummary ) =>
	[ summary.firstMessage, summary.lastMessage ]
		.map( parseWorkspaceDollyHistoryMessage )
		.filter( ( message ): message is WorkspaceDollyHistoryMessage => Boolean( message ) );

export const parseWorkspaceDollyHistorySummary = (
	value: unknown
): WorkspaceDollyHistorySummary | undefined => {
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
		createdAt: parseWorkspaceDollyHistoryDate( value.created_at ?? value.createdAt ),
		firstMessage: isRecord( value.first_message ) ? value.first_message : undefined,
		lastMessage: isRecord( value.last_message ) ? value.last_message : undefined,
	};
};

export const parseWorkspaceDollyHistoryChat = (
	value: unknown,
	summary: WorkspaceDollyHistorySummary,
	includeFallbackMessages = true
): WorkspaceDollyHistoryChat | undefined => {
	if ( ! isRecord( value ) ) {
		return undefined;
	}

	const chatId = getFlexibleNumberValue( value, [ 'chat_id', 'chatID', 'id' ] ) ?? summary.chatId;
	const rawMessages = Array.isArray( value.messages ) ? value.messages : [];
	const messages = rawMessages
		.map( parseWorkspaceDollyHistoryMessage )
		.filter( ( message ): message is WorkspaceDollyHistoryMessage => Boolean( message ) );
	const fallbackMessages = includeFallbackMessages
		? createWorkspaceDollyHistoryFallbackMessages( summary )
		: [];

	return {
		chatId,
		sessionId: getStringFromRecord( value, [ 'session_id', 'sessionId' ] ) ?? summary.sessionId,
		siteId: extractBackendSelectedSiteIdFromRecord( value ) ?? summary.siteId,
		createdAt:
			parseWorkspaceDollyHistoryDate( value.created_at ?? value.createdAt ) ?? summary.createdAt,
		messages: messages.length > 0 ? messages : fallbackMessages,
	};
};

export const createWorkspaceDollyConversationStateFromHistoryItems = (
	target: WorkspaceDollyTargetDescriptor,
	historyItems: Array< { summary: WorkspaceDollyHistorySummary; chat?: WorkspaceDollyHistoryChat } >
): WorkspaceDollyConversationState | undefined => {
	const sortedHistoryItems = [ ...historyItems ].sort(
		( first, second ) => ( second.summary.createdAt ?? 0 ) - ( first.summary.createdAt ?? 0 )
	);
	const latestHistoryItem = sortedHistoryItems[ 0 ];
	if ( ! latestHistoryItem ) {
		return undefined;
	}

	const messages = deduplicateWorkspaceDollyHistoryMessages(
		historyItems.flatMap( ( { summary, chat } ) =>
			chat?.messages.length ? chat.messages : createWorkspaceDollyHistoryFallbackMessages( summary )
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
		id: `wpcom:${ WORKSPACE_DOLLY_AGENT_ID }:${ latestHistoryItem.summary.chatId }`,
		key: {
			workspaceId: target.workspaceId,
			targetId: target.targetId,
			siteId: target.site.id,
			agentId: WORKSPACE_DOLLY_AGENT_ID,
		},
		remoteChatId: latestHistoryItem.summary.chatId,
		serverHydrationDisabled: false,
		input: '',
		messages: createWorkspaceDollyMessagesFromHistory( messages ),
		sessionId: chatWithSession?.chat?.sessionId ?? latestHistoryItem.summary.sessionId,
		lastUpdated,
	};
};

export const fetchWorkspaceDollyHistorySummaries = async (
	client: WPCOM,
	itemsPerPage = WORKSPACE_DOLLY_HISTORY_SUMMARY_ITEMS_PER_PAGE,
	maxPages = WORKSPACE_DOLLY_HISTORY_MAX_PAGES
): Promise< WorkspaceDollyHistorySummary[] > => {
	const summaries: WorkspaceDollyHistorySummary[] = [];
	const seenChatIds = new Set< number >();

	for ( let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1 ) {
		const query = new URLSearchParams( {
			truncation_method: 'last_message',
			page_number: String( pageNumber ),
			items_per_page: String( itemsPerPage ),
		} );
		const response = await wpcomGet< unknown >(
			client,
			`/ai/chats/${ WORKSPACE_DOLLY_HISTORY_BOT_ID }?${ query.toString() }`
		);
		const pageSummaries = extractWorkspaceDollyHistoryEntries( response )
			.map( parseWorkspaceDollyHistorySummary )
			.filter( ( summary ): summary is WorkspaceDollyHistorySummary => Boolean( summary ) );

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

export const fetchWorkspaceDollyHistoryChatPage = async (
	client: WPCOM,
	summary: WorkspaceDollyHistorySummary,
	pageNumber: number,
	itemsPerPage: number
): Promise< WorkspaceDollyHistoryChat | undefined > => {
	const query = new URLSearchParams( {
		page_number: String( pageNumber ),
		items_per_page: String( itemsPerPage ),
	} );
	const response = await wpcomGet< unknown >(
		client,
		`/ai/chat/${ WORKSPACE_DOLLY_HISTORY_BOT_ID }/${ summary.chatId }?${ query.toString() }`
	);
	return parseWorkspaceDollyHistoryChat( response, summary, pageNumber === 1 );
};

export const fetchWorkspaceDollyHistoryChat = async (
	client: WPCOM,
	summary: WorkspaceDollyHistorySummary,
	itemsPerPage = WORKSPACE_DOLLY_HISTORY_CHAT_ITEMS_PER_PAGE,
	maxPages = WORKSPACE_DOLLY_HISTORY_MAX_PAGES
): Promise< WorkspaceDollyHistoryChat | undefined > => {
	const messages: WorkspaceDollyHistoryMessage[] = [];
	let mergedChat: WorkspaceDollyHistoryChat | undefined;

	for ( let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1 ) {
		const chatPage = await fetchWorkspaceDollyHistoryChatPage(
			client,
			summary,
			pageNumber,
			itemsPerPage
		);
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
		messages: deduplicateWorkspaceDollyHistoryMessages( messages ),
	};
};

export const hydrateWorkspaceDollyConversationStates = async (
	client: WPCOM,
	target: WorkspaceDollyTargetDescriptor,
	preferredSessionId?: string
): Promise< WorkspaceDollyConversationState[] > => {
	const summaries = await fetchWorkspaceDollyHistorySummaries( client );
	const normalizedPreferredSessionId = normalizeDollySessionId( preferredSessionId );
	const groupedSummaries = new Map< string, WorkspaceDollyHistorySummary[] >();

	for ( const summary of summaries ) {
		const normalizedSessionId = normalizeDollySessionId( summary.sessionId );
		const matchesPreferredSession =
			normalizedPreferredSessionId &&
			normalizedSessionId === normalizedPreferredSessionId &&
			( summary.siteId === target.site.id || summary.siteId === undefined );

		if ( summary.siteId !== target.site.id && ! matchesPreferredSession ) {
			continue;
		}

		const groupKey = normalizedSessionId
			? `session:${ normalizedSessionId }`
			: `chat:${ summary.chatId }`;
		groupedSummaries.set( groupKey, [ ...( groupedSummaries.get( groupKey ) ?? [] ), summary ] );
	}

	const hydratedConversationStates: WorkspaceDollyConversationState[] = [];

	for ( const groupSummaries of groupedSummaries.values() ) {
		const sortedGroupSummaries = [ ...groupSummaries ].sort(
			( first, second ) => ( second.createdAt ?? 0 ) - ( first.createdAt ?? 0 )
		);
		const historyItems: Array< {
			summary: WorkspaceDollyHistorySummary;
			chat?: WorkspaceDollyHistoryChat;
		} > = [];

		for ( const summary of sortedGroupSummaries ) {
			try {
				historyItems.push( {
					summary,
					chat: await fetchWorkspaceDollyHistoryChat( client, summary ),
				} );
			} catch ( error ) {
				console.error( error );
				historyItems.push( { summary } );
			}
		}

		const conversationState = createWorkspaceDollyConversationStateFromHistoryItems(
			target,
			historyItems
		);

		if ( conversationState ) {
			hydratedConversationStates.push( conversationState );
		}
	}

	return hydratedConversationStates.sort(
		( first, second ) => second.lastUpdated - first.lastUpdated
	);
};
