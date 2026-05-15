import { LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY } from 'src/constants';
import { initialPreviewState } from 'src/modules/wpcom-site-assistant/lib/preview';
import { clearWpcomSiteAssistantTurnsForTests } from 'src/modules/wpcom-site-assistant/lib/turns';
import {
	DOLLY_AGENT_ID,
	type DollyPreviewState,
	type WpcomSiteAssistantSessionState,
} from 'src/modules/wpcom-site-assistant/lib/types';
import {
	flexibleNumber,
	isRecord,
	normalizeDollySessionId,
} from 'src/modules/wpcom-site-assistant/lib/utils';
import type { SyncSite } from '@studio/common/types/sync';
import type { Message as MessageType } from 'src/stores/chat-slice';

const LEGACY_LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_V4_KEY =
	'dolly_wpcom_site_conversations_v4';
const LEGACY_LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_V5_KEY =
	'dolly_wpcom_site_conversations_v5';

type PersistedWpcomSiteAssistantCache = {
	version: 6;
	conversations: Record< string, WpcomSiteAssistantSessionState >;
	selectedConversationIdsBySiteId: Record< string, string >;
	targetPreviewStatesBySiteId: Record< string, DollyPreviewState >;
	hiddenRemoteConversationKeysBySiteId: Record< string, string[] >;
};

export const wpcomSiteAssistantSessionStateCache = new Map<
	string,
	WpcomSiteAssistantSessionState
>();
export const wpcomSiteAssistantSelectedConversationIdsBySiteId = new Map< number, string >();
export const wpcomSiteAssistantTargetPreviewStateCache = new Map< number, DollyPreviewState >();
export const wpcomSiteAssistantHiddenRemoteConversationKeysBySiteId = new Map<
	number,
	Set< string >
>();
let hasLoadedWpcomSiteAssistantSessionStateCache = false;

const sanitizePreviewState = ( value: unknown ): DollyPreviewState => {
	const previewState = isRecord( value )
		? {
				...initialPreviewState(),
				...value,
		  }
		: initialPreviewState();

	return {
		open: Boolean( previewState.open ),
		pathOrUrl: typeof previewState.pathOrUrl === 'string' ? previewState.pathOrUrl : '/',
		title: typeof previewState.title === 'string' ? previewState.title : undefined,
		currentUrl: typeof previewState.currentUrl === 'string' ? previewState.currentUrl : undefined,
		pageTitle: typeof previewState.pageTitle === 'string' ? previewState.pageTitle : undefined,
		isLoading: false,
		reloadNonce: flexibleNumber( previewState.reloadNonce ) ?? 0,
	};
};

export const clearWpcomSiteAssistantStateCacheForTests = () => {
	wpcomSiteAssistantSessionStateCache.clear();
	wpcomSiteAssistantSelectedConversationIdsBySiteId.clear();
	wpcomSiteAssistantTargetPreviewStateCache.clear();
	wpcomSiteAssistantHiddenRemoteConversationKeysBySiteId.clear();
	clearWpcomSiteAssistantTurnsForTests();
	hasLoadedWpcomSiteAssistantSessionStateCache = false;
	localStorage.removeItem( LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY );
	localStorage.removeItem( LEGACY_LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_V5_KEY );
	localStorage.removeItem( LEGACY_LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_V4_KEY );
};

export const createWpcomSiteAssistantSessionKey = ( siteId: number ) => `wpcom-site:${ siteId }`;

export const createWpcomSiteAssistantConversationId = () => `local:${ crypto.randomUUID() }`;

const getWpcomSiteAssistantRemoteConversationKeys = (
	sessionState: Pick< WpcomSiteAssistantSessionState, 'remoteChatId' | 'sessionId' >
) => {
	const keys: string[] = [];
	if ( sessionState.remoteChatId !== undefined ) {
		keys.push( `chat:${ sessionState.remoteChatId }` );
	}

	const normalizedSessionId = normalizeDollySessionId( sessionState.sessionId );
	if ( normalizedSessionId ) {
		keys.push( `session:${ normalizedSessionId }` );
	}

	return keys;
};

export const isWpcomSiteAssistantRemoteConversationHidden = (
	sessionState: WpcomSiteAssistantSessionState
) => {
	const hiddenKeys = wpcomSiteAssistantHiddenRemoteConversationKeysBySiteId.get(
		sessionState.key.siteId
	);
	if ( ! hiddenKeys ) {
		return false;
	}

	return getWpcomSiteAssistantRemoteConversationKeys( sessionState ).some( ( key ) =>
		hiddenKeys.has( key )
	);
};

const addHiddenWpcomSiteAssistantRemoteConversation = (
	sessionState: WpcomSiteAssistantSessionState
) => {
	const keys = getWpcomSiteAssistantRemoteConversationKeys( sessionState );
	if ( keys.length === 0 ) {
		return;
	}

	const hiddenKeys =
		wpcomSiteAssistantHiddenRemoteConversationKeysBySiteId.get( sessionState.key.siteId ) ??
		new Set< string >();
	keys.forEach( ( key ) => hiddenKeys.add( key ) );
	wpcomSiteAssistantHiddenRemoteConversationKeysBySiteId.set( sessionState.key.siteId, hiddenKeys );
};

export const cloneWpcomSiteAssistantSessionState = (
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

export const normalizePersistedWpcomSiteAssistantSessionState = (
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
		previewState: sanitizePreviewState( value.previewState ),
		lastUpdated: flexibleNumber( value.lastUpdated ) ?? Date.now(),
	};
};

const addConversationStateToCache = ( sessionState: WpcomSiteAssistantSessionState ) => {
	wpcomSiteAssistantSessionStateCache.set( sessionState.id, sessionState );

	const selectedConversationId = wpcomSiteAssistantSelectedConversationIdsBySiteId.get(
		sessionState.key.siteId
	);
	if ( ! selectedConversationId ) {
		wpcomSiteAssistantSelectedConversationIdsBySiteId.set(
			sessionState.key.siteId,
			sessionState.id
		);
	}

	if ( ! wpcomSiteAssistantTargetPreviewStateCache.has( sessionState.key.siteId ) ) {
		wpcomSiteAssistantTargetPreviewStateCache.set(
			sessionState.key.siteId,
			sessionState.previewState
		);
	}
};

const loadPersistedWpcomSiteAssistantCache = ( parsed: unknown ) => {
	if ( ! isRecord( parsed ) ) {
		return false;
	}

	const conversations = isRecord( parsed.conversations ) ? parsed.conversations : undefined;
	if ( ! conversations ) {
		return false;
	}

	for ( const value of Object.values( conversations ) ) {
		const sessionState = normalizePersistedWpcomSiteAssistantSessionState( value );
		if ( sessionState ) {
			addConversationStateToCache( sessionState );
		}
	}

	if ( isRecord( parsed.selectedConversationIdsBySiteId ) ) {
		for ( const [ siteId, conversationId ] of Object.entries(
			parsed.selectedConversationIdsBySiteId
		) ) {
			const numericSiteId = Number( siteId );
			if (
				Number.isFinite( numericSiteId ) &&
				typeof conversationId === 'string' &&
				wpcomSiteAssistantSessionStateCache.has( conversationId )
			) {
				wpcomSiteAssistantSelectedConversationIdsBySiteId.set( numericSiteId, conversationId );
			}
		}
	}

	if ( isRecord( parsed.targetPreviewStatesBySiteId ) ) {
		for ( const [ siteId, previewState ] of Object.entries( parsed.targetPreviewStatesBySiteId ) ) {
			const numericSiteId = Number( siteId );
			if ( Number.isFinite( numericSiteId ) ) {
				wpcomSiteAssistantTargetPreviewStateCache.set(
					numericSiteId,
					sanitizePreviewState( previewState )
				);
			}
		}
	}

	if ( isRecord( parsed.hiddenRemoteConversationKeysBySiteId ) ) {
		for ( const [ siteId, hiddenKeys ] of Object.entries(
			parsed.hiddenRemoteConversationKeysBySiteId
		) ) {
			const numericSiteId = Number( siteId );
			if ( ! Number.isFinite( numericSiteId ) || ! Array.isArray( hiddenKeys ) ) {
				continue;
			}

			wpcomSiteAssistantHiddenRemoteConversationKeysBySiteId.set(
				numericSiteId,
				new Set(
					hiddenKeys.filter( ( hiddenKey ): hiddenKey is string => typeof hiddenKey === 'string' )
				)
			);
		}
	}

	return true;
};

const migrateLegacyWpcomSiteAssistantCache = ( parsed: unknown ) => {
	if ( ! isRecord( parsed ) ) {
		return;
	}

	for ( const value of Object.values( parsed ) ) {
		const sessionState = normalizePersistedWpcomSiteAssistantSessionState( value );
		if ( sessionState ) {
			addConversationStateToCache( sessionState );
			wpcomSiteAssistantSelectedConversationIdsBySiteId.set(
				sessionState.key.siteId,
				sessionState.id
			);
			wpcomSiteAssistantTargetPreviewStateCache.set(
				sessionState.key.siteId,
				sessionState.previewState
			);
		}
	}
};

export const loadWpcomSiteAssistantSessionStateCache = () => {
	if ( hasLoadedWpcomSiteAssistantSessionStateCache ) {
		return;
	}

	hasLoadedWpcomSiteAssistantSessionStateCache = true;
	const rawCache = localStorage.getItem( LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY );

	try {
		if ( rawCache ) {
			const parsedCache = JSON.parse( rawCache );
			if ( loadPersistedWpcomSiteAssistantCache( parsedCache ) ) {
				return;
			}
			migrateLegacyWpcomSiteAssistantCache( parsedCache );
			persistWpcomSiteAssistantSessionStateCache();
			return;
		}

		const rawV5Cache = localStorage.getItem(
			LEGACY_LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_V5_KEY
		);
		if ( rawV5Cache ) {
			const parsedV5Cache = JSON.parse( rawV5Cache );
			if ( ! loadPersistedWpcomSiteAssistantCache( parsedV5Cache ) ) {
				migrateLegacyWpcomSiteAssistantCache( parsedV5Cache );
			}
			persistWpcomSiteAssistantSessionStateCache();
			return;
		}

		const rawV4Cache = localStorage.getItem(
			LEGACY_LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_V4_KEY
		);
		if ( rawV4Cache ) {
			migrateLegacyWpcomSiteAssistantCache( JSON.parse( rawV4Cache ) );
			persistWpcomSiteAssistantSessionStateCache();
		}
	} catch ( error ) {
		console.error( error );
	}
};

export const persistWpcomSiteAssistantSessionStateCache = () => {
	const cache: PersistedWpcomSiteAssistantCache = {
		version: 6,
		conversations: Object.fromEntries(
			Array.from( wpcomSiteAssistantSessionStateCache.entries() ).map( ( [ key, value ] ) => [
				key,
				cloneWpcomSiteAssistantSessionState( value ),
			] )
		),
		selectedConversationIdsBySiteId: Object.fromEntries(
			wpcomSiteAssistantSelectedConversationIdsBySiteId.entries()
		),
		targetPreviewStatesBySiteId: Object.fromEntries(
			Array.from( wpcomSiteAssistantTargetPreviewStateCache.entries() ).map(
				( [ siteId, previewState ] ) => [ siteId, sanitizePreviewState( previewState ) ]
			)
		),
		hiddenRemoteConversationKeysBySiteId: Object.fromEntries(
			Array.from( wpcomSiteAssistantHiddenRemoteConversationKeysBySiteId.entries() ).map(
				( [ siteId, hiddenKeys ] ) => [ siteId, Array.from( hiddenKeys ) ]
			)
		),
	};
	localStorage.setItem( LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY, JSON.stringify( cache ) );
};

export const createWpcomSiteAssistantSessionState = (
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
	previewState: getWpcomSiteAssistantTargetPreviewState( selectedWpcomSite ),
	lastUpdated: Date.now(),
} );

export const setSelectedWpcomSiteAssistantConversationId = (
	siteId: number,
	conversationId: string
) => {
	wpcomSiteAssistantSelectedConversationIdsBySiteId.set( siteId, conversationId );
	persistWpcomSiteAssistantSessionStateCache();
};

export const createNewWpcomSiteAssistantConversation = ( selectedWpcomSite: SyncSite ) => {
	loadWpcomSiteAssistantSessionStateCache();
	const sessionState = createWpcomSiteAssistantSessionState( selectedWpcomSite );
	wpcomSiteAssistantSessionStateCache.set( sessionState.id, sessionState );
	setSelectedWpcomSiteAssistantConversationId( selectedWpcomSite.id, sessionState.id );
	return cloneWpcomSiteAssistantSessionState( sessionState );
};

export const getWpcomSiteAssistantConversationsForSite = ( siteId: number ) => {
	loadWpcomSiteAssistantSessionStateCache();
	return Array.from( wpcomSiteAssistantSessionStateCache.values() )
		.filter( ( sessionState ) => sessionState.key.siteId === siteId )
		.filter( ( sessionState ) => ! isWpcomSiteAssistantRemoteConversationHidden( sessionState ) )
		.sort( ( first, second ) => second.lastUpdated - first.lastUpdated )
		.map( cloneWpcomSiteAssistantSessionState );
};

export const deleteWpcomSiteAssistantConversation = (
	conversationId: string,
	selectedWpcomSite: SyncSite
) => {
	loadWpcomSiteAssistantSessionStateCache();
	const sessionState = wpcomSiteAssistantSessionStateCache.get( conversationId );
	if ( sessionState?.key.siteId === selectedWpcomSite.id ) {
		addHiddenWpcomSiteAssistantRemoteConversation( sessionState );
		wpcomSiteAssistantSessionStateCache.delete( conversationId );
	}

	const selectedConversationId = wpcomSiteAssistantSelectedConversationIdsBySiteId.get(
		selectedWpcomSite.id
	);
	if ( selectedConversationId !== conversationId ) {
		persistWpcomSiteAssistantSessionStateCache();
		return selectedConversationId
			? cloneWpcomSiteAssistantSessionState(
					wpcomSiteAssistantSessionStateCache.get( selectedConversationId ) ??
						createNewWpcomSiteAssistantConversation( selectedWpcomSite )
			  )
			: createNewWpcomSiteAssistantConversation( selectedWpcomSite );
	}

	const nextSessionState = Array.from( wpcomSiteAssistantSessionStateCache.values() )
		.filter( ( candidate ) => candidate.key.siteId === selectedWpcomSite.id )
		.filter( ( candidate ) => ! isWpcomSiteAssistantRemoteConversationHidden( candidate ) )
		.sort( ( first, second ) => second.lastUpdated - first.lastUpdated )[ 0 ];

	if ( nextSessionState ) {
		wpcomSiteAssistantSelectedConversationIdsBySiteId.set(
			selectedWpcomSite.id,
			nextSessionState.id
		);
		persistWpcomSiteAssistantSessionStateCache();
		return cloneWpcomSiteAssistantSessionState( nextSessionState );
	}

	return createNewWpcomSiteAssistantConversation( selectedWpcomSite );
};

export const getWpcomSiteAssistantSessionState = (
	_sessionKey: string,
	selectedWpcomSite: SyncSite
): WpcomSiteAssistantSessionState => {
	loadWpcomSiteAssistantSessionStateCache();
	const selectedConversationId = wpcomSiteAssistantSelectedConversationIdsBySiteId.get(
		selectedWpcomSite.id
	);
	const cachedSessionState = selectedConversationId
		? wpcomSiteAssistantSessionStateCache.get( selectedConversationId )
		: undefined;

	if ( ! cachedSessionState || cachedSessionState.key.siteId !== selectedWpcomSite.id ) {
		return createNewWpcomSiteAssistantConversation( selectedWpcomSite );
	}

	const sessionState = cloneWpcomSiteAssistantSessionState( cachedSessionState );
	return {
		...sessionState,
		activeWpcomSite:
			sessionState.activeWpcomSite.id === selectedWpcomSite.id
				? selectedWpcomSite
				: sessionState.activeWpcomSite,
		previewState: getWpcomSiteAssistantTargetPreviewState( selectedWpcomSite ),
	};
};

export const getWpcomSiteAssistantTargetPreviewState = ( selectedWpcomSite: SyncSite ) => {
	loadWpcomSiteAssistantSessionStateCache();
	const cachedPreviewState = wpcomSiteAssistantTargetPreviewStateCache.get( selectedWpcomSite.id );
	if ( cachedPreviewState ) {
		return { ...cachedPreviewState };
	}

	const previewState = initialPreviewState();
	wpcomSiteAssistantTargetPreviewStateCache.set( selectedWpcomSite.id, previewState );
	persistWpcomSiteAssistantSessionStateCache();
	return { ...previewState };
};

export const setWpcomSiteAssistantTargetPreviewState = (
	siteId: number,
	previewState: DollyPreviewState
) => {
	wpcomSiteAssistantTargetPreviewStateCache.set( siteId, sanitizePreviewState( previewState ) );
	persistWpcomSiteAssistantSessionStateCache();
};

export const mergeWpcomSiteAssistantConversationState = (
	hydratedSessionState: WpcomSiteAssistantSessionState,
	{ selectIfEmpty = false }: { selectIfEmpty?: boolean } = {}
) => {
	loadWpcomSiteAssistantSessionStateCache();
	if ( isWpcomSiteAssistantRemoteConversationHidden( hydratedSessionState ) ) {
		return cloneWpcomSiteAssistantSessionState( hydratedSessionState );
	}

	const matchingConversation = Array.from( wpcomSiteAssistantSessionStateCache.values() ).find(
		( candidate ) => {
			if ( candidate.key.siteId !== hydratedSessionState.key.siteId ) {
				return false;
			}

			if (
				candidate.remoteChatId !== undefined &&
				candidate.remoteChatId === hydratedSessionState.remoteChatId
			) {
				return true;
			}

			const candidateSessionId = normalizeDollySessionId( candidate.sessionId );
			const hydratedSessionId = normalizeDollySessionId( hydratedSessionState.sessionId );
			return (
				candidateSessionId !== undefined &&
				hydratedSessionId !== undefined &&
				candidateSessionId === hydratedSessionId
			);
		}
	);
	const currentSessionState = matchingConversation
		? cloneWpcomSiteAssistantSessionState( matchingConversation )
		: undefined;
	const nextSessionState = currentSessionState
		? {
				...hydratedSessionState,
				id: currentSessionState.id,
				input: currentSessionState.input,
				previewState: getWpcomSiteAssistantTargetPreviewState(
					hydratedSessionState.activeWpcomSite
				),
		  }
		: hydratedSessionState;

	if (
		currentSessionState &&
		! shouldApplyWpcomSiteAssistantHydration( currentSessionState, hydratedSessionState )
	) {
		return currentSessionState;
	}

	wpcomSiteAssistantSessionStateCache.set( nextSessionState.id, nextSessionState );

	const selectedConversationId = wpcomSiteAssistantSelectedConversationIdsBySiteId.get(
		nextSessionState.key.siteId
	);
	const selectedConversation = selectedConversationId
		? wpcomSiteAssistantSessionStateCache.get( selectedConversationId )
		: undefined;
	if (
		! selectedConversation ||
		( selectIfEmpty &&
			selectedConversation.messages.length === 0 &&
			! selectedConversation.input.trim() )
	) {
		wpcomSiteAssistantSelectedConversationIdsBySiteId.set(
			nextSessionState.key.siteId,
			nextSessionState.id
		);
	}

	persistWpcomSiteAssistantSessionStateCache();
	return cloneWpcomSiteAssistantSessionState( nextSessionState );
};

export const shouldApplyWpcomSiteAssistantHydration = (
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
