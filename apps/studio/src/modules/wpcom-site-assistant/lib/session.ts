import { LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY } from 'src/constants';
import { initialPreviewState } from 'src/modules/wpcom-site-assistant/lib/preview';
import {
	DOLLY_AGENT_ID,
	type WpcomSiteAssistantSessionState,
} from 'src/modules/wpcom-site-assistant/lib/types';
import {
	flexibleNumber,
	isRecord,
	normalizeDollySessionId,
} from 'src/modules/wpcom-site-assistant/lib/utils';
import type { SyncSite } from '@studio/common/types/sync';
import type { Message as MessageType } from 'src/stores/chat-slice';

export const wpcomSiteAssistantSessionStateCache = new Map<
	string,
	WpcomSiteAssistantSessionState
>();
let hasLoadedWpcomSiteAssistantSessionStateCache = false;

export const clearWpcomSiteAssistantStateCacheForTests = () => {
	wpcomSiteAssistantSessionStateCache.clear();
	hasLoadedWpcomSiteAssistantSessionStateCache = false;
	localStorage.removeItem( LOCAL_STORAGE_DOLLY_WPCOM_SITE_CONVERSATIONS_KEY );
};

export const createWpcomSiteAssistantSessionKey = ( siteId: number ) => `wpcom-site:${ siteId }`;

export const createWpcomSiteAssistantConversationId = () => `local:${ crypto.randomUUID() }`;

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

export const loadWpcomSiteAssistantSessionStateCache = () => {
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

export const persistWpcomSiteAssistantSessionStateCache = () => {
	const cache = Object.fromEntries(
		Array.from( wpcomSiteAssistantSessionStateCache.entries() ).map( ( [ key, value ] ) => [
			key,
			cloneWpcomSiteAssistantSessionState( value ),
		] )
	);
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
	previewState: initialPreviewState(),
	lastUpdated: Date.now(),
} );

export const getWpcomSiteAssistantSessionState = (
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
