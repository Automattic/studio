import { initialPreviewState } from 'src/modules/wpcom-site-assistant/lib/preview';
import {
	DOLLY_AGENT_ID,
	DOLLY_HISTORY_BOT_ID,
	DOLLY_HISTORY_CHAT_ITEMS_PER_PAGE,
	DOLLY_HISTORY_MAX_PAGES,
	DOLLY_HISTORY_SUMMARY_ITEMS_PER_PAGE,
	DOLLY_REQUEST_TIMEOUT_MS,
	type DollyAgentResponse,
	type DollyHistoryChat,
	type DollyHistoryMessage,
	type DollyHistorySummary,
	type DollySite,
	type WpcomSiteAssistantSessionState,
} from 'src/modules/wpcom-site-assistant/lib/types';
import {
	flexibleNumber,
	getFlexibleNumberValue,
	getStringFromRecord,
	isRecord,
	normalizeDollySessionId,
	normalizeSiteBaseUrl,
} from 'src/modules/wpcom-site-assistant/lib/utils';
import { Message as MessageType } from 'src/stores/chat-slice';
import type { SyncSite } from '@studio/common/types/sync';
import type { WPCOM } from 'wpcom/types';

export const parseDollySites = ( response: unknown ): DollySite[] => {
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

export const createSyncSiteFromDollySite = ( site: DollySite ): SyncSite | undefined => {
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

export const extractBackendSelectedSiteIdFromRecord = (
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

export const extractBackendSelectedSiteId = ( response: unknown ): number | undefined => {
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

export const extractDollyHistoryEntries = ( response: unknown ): Record< string, unknown >[] => {
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

export const parseDollySessionSiteId = (
	response: unknown,
	sessionId: string
): number | undefined => {
	const entries = extractDollyHistoryEntries( response );
	const matchingEntry = entries.find(
		( entry ) => getStringFromRecord( entry, [ 'sessionId', 'session_id' ] ) === sessionId
	);

	return matchingEntry ? extractBackendSelectedSiteIdFromRecord( matchingEntry ) : undefined;
};

export const fetchDollySessionSiteId = async (
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

export const resolveBackendSelectedSiteId = async (
	client: WPCOM,
	response: DollyAgentResponse,
	previousSessionId?: string
): Promise< number | undefined > =>
	response.selectedSiteId ??
	fetchDollySessionSiteId( client, response.sessionId ?? previousSessionId );

export const fetchDollySite = async (
	client: WPCOM,
	siteId: number
): Promise< SyncSite | undefined > => {
	try {
		const response = await wpcomGet< unknown >( client, '/ai/agent/dolly/sites' );
		const site = parseDollySites( response ).find( ( candidate ) => candidate.id === siteId );
		return site ? createSyncSiteFromDollySite( site ) : undefined;
	} catch ( error ) {
		console.error( error );
		return undefined;
	}
};

export const parseDollyHistoryDate = ( value: unknown ): number | undefined => {
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

export const visibleDollyHistoryMessageText = ( value: string ) => {
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

export const parseDollyHistoryMessage = ( value: unknown ): DollyHistoryMessage | undefined => {
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

export const createMessagesFromDollyHistory = ( messages: DollyHistoryMessage[] ): MessageType[] =>
	messages.map( ( message, index ) => ( {
		id: index,
		content: message.content,
		role: message.role,
		createdAt: message.createdAt,
		feedbackReceived: false,
		messageApiId: message.messageApiId,
	} ) );

export const createDollyHistoryMessageKey = ( message: DollyHistoryMessage ) =>
	message.messageApiId !== undefined
		? `id:${ message.messageApiId }`
		: `fallback:${ message.createdAt }:${ message.role }:${ message.content }`;

export const sortDollyHistoryMessages = ( messages: DollyHistoryMessage[] ) =>
	[ ...messages ].sort( ( first, second ) => {
		const dateComparison = first.createdAt - second.createdAt;
		if ( dateComparison !== 0 ) {
			return dateComparison;
		}
		return ( first.messageApiId ?? 0 ) - ( second.messageApiId ?? 0 );
	} );

export const deduplicateDollyHistoryMessages = ( messages: DollyHistoryMessage[] ) => {
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

export const createDollyHistoryFallbackMessages = ( summary: DollyHistorySummary ) =>
	[ summary.firstMessage, summary.lastMessage ]
		.map( parseDollyHistoryMessage )
		.filter( ( message ): message is DollyHistoryMessage => Boolean( message ) );

export const parseDollyHistorySummary = ( value: unknown ): DollyHistorySummary | undefined => {
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

export const parseDollyHistoryChat = (
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

export const createWpcomSiteAssistantSessionStateFromHistory = (
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

export const createWpcomSiteAssistantSessionStateFromHistoryItems = (
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

export const fetchDollyHistorySummaries = async (
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

export const fetchDollyHistoryChatPage = async (
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

export const fetchDollyHistoryChat = async (
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

export const hydrateWpcomSiteAssistantSessionState = async (
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
