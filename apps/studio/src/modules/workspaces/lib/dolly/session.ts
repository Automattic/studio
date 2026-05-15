import { clearWorkspaceDollyTargetActivityForTests } from 'src/modules/workspaces/lib/dolly/turns';
import {
	WORKSPACE_DOLLY_AGENT_ID,
	type WorkspaceDollyConversationState,
	type WorkspaceDollyTargetDescriptor,
} from 'src/modules/workspaces/lib/dolly/types';
import {
	flexibleNumber,
	isRecord,
	normalizeDollySessionId,
} from 'src/modules/workspaces/lib/dolly/utils';
import type { Message as MessageType } from 'src/stores/chat-slice';

export const WORKSPACE_DOLLY_CONVERSATIONS_STORAGE_KEY = 'studio_workspace_dolly_conversations_v1';

type PersistedWorkspaceDollyCache = {
	version: 1;
	conversations: Record< string, WorkspaceDollyConversationState >;
	selectedConversationIdsByTargetKey: Record< string, string >;
	hiddenRemoteConversationKeysByTargetKey: Record< string, string[] >;
};

const conversationCache = new Map< string, WorkspaceDollyConversationState >();
const selectedConversationIdsByTargetKey = new Map< string, string >();
const hiddenRemoteConversationKeysByTargetKey = new Map< string, Set< string > >();
let hasLoadedConversationCache = false;

export const createWorkspaceDollyTargetCacheKey = ( {
	workspaceId,
	targetId,
	site,
}: WorkspaceDollyTargetDescriptor ) => `${ workspaceId }:${ targetId }:${ site.id }`;

const createWorkspaceDollyConversationTargetCacheKey = (
	conversationState: WorkspaceDollyConversationState
) =>
	`${ conversationState.key.workspaceId }:${ conversationState.key.targetId }:${ conversationState.key.siteId }`;

export const createWorkspaceDollyConversationId = () => `local:${ crypto.randomUUID() }`;

const createRemoteConversationKeys = (
	conversationState: Pick< WorkspaceDollyConversationState, 'remoteChatId' | 'sessionId' >
) => {
	const keys: string[] = [];
	if ( conversationState.remoteChatId !== undefined ) {
		keys.push( `chat:${ conversationState.remoteChatId }` );
	}

	const normalizedSessionId = normalizeDollySessionId( conversationState.sessionId );
	if ( normalizedSessionId ) {
		keys.push( `session:${ normalizedSessionId }` );
	}

	return keys;
};

const isRemoteConversationHidden = ( conversationState: WorkspaceDollyConversationState ) => {
	const hiddenKeys = hiddenRemoteConversationKeysByTargetKey.get(
		createWorkspaceDollyConversationTargetCacheKey( conversationState )
	);
	if ( ! hiddenKeys ) {
		return false;
	}

	return createRemoteConversationKeys( conversationState ).some( ( key ) => hiddenKeys.has( key ) );
};

const addHiddenRemoteConversation = ( conversationState: WorkspaceDollyConversationState ) => {
	const keys = createRemoteConversationKeys( conversationState );
	if ( keys.length === 0 ) {
		return;
	}

	const targetKey = createWorkspaceDollyConversationTargetCacheKey( conversationState );
	const hiddenKeys =
		hiddenRemoteConversationKeysByTargetKey.get( targetKey ) ?? new Set< string >();
	keys.forEach( ( key ) => hiddenKeys.add( key ) );
	hiddenRemoteConversationKeysByTargetKey.set( targetKey, hiddenKeys );
};

export const cloneWorkspaceDollyConversationState = (
	conversationState: WorkspaceDollyConversationState
): WorkspaceDollyConversationState => ( {
	...conversationState,
	key: { ...conversationState.key },
	messages: conversationState.messages.map( ( message ) => {
		const { failedMessage: _failedMessage, ...messageWithoutRuntimeState } = message;
		return messageWithoutRuntimeState;
	} ),
} );

const normalizePersistedWorkspaceDollyConversationState = (
	value: unknown
): WorkspaceDollyConversationState | undefined => {
	if ( ! isRecord( value ) || ! isRecord( value.key ) ) {
		return undefined;
	}

	const workspaceId = typeof value.key.workspaceId === 'string' ? value.key.workspaceId : undefined;
	const targetId =
		value.key.targetId === 'production' || value.key.targetId === 'staging'
			? value.key.targetId
			: undefined;
	const siteId = flexibleNumber( value.key.siteId );
	const agentId = typeof value.key.agentId === 'string' ? value.key.agentId : undefined;

	if ( ! workspaceId || ! targetId || ! siteId || agentId !== WORKSPACE_DOLLY_AGENT_ID ) {
		return undefined;
	}

	const id =
		typeof value.id === 'string' && value.id.trim()
			? value.id
			: createWorkspaceDollyConversationId();

	return {
		id,
		key: {
			workspaceId,
			targetId,
			siteId,
			agentId: WORKSPACE_DOLLY_AGENT_ID,
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
		lastUpdated: flexibleNumber( value.lastUpdated ) ?? Date.now(),
	};
};

const addConversationStateToCache = ( conversationState: WorkspaceDollyConversationState ) => {
	conversationCache.set( conversationState.id, conversationState );

	const targetKey = createWorkspaceDollyConversationTargetCacheKey( conversationState );
	if ( ! selectedConversationIdsByTargetKey.has( targetKey ) ) {
		selectedConversationIdsByTargetKey.set( targetKey, conversationState.id );
	}
};

const loadPersistedWorkspaceDollyCache = ( parsed: unknown ) => {
	if ( ! isRecord( parsed ) || parsed.version !== 1 || ! isRecord( parsed.conversations ) ) {
		return false;
	}

	for ( const value of Object.values( parsed.conversations ) ) {
		const conversationState = normalizePersistedWorkspaceDollyConversationState( value );
		if ( conversationState ) {
			addConversationStateToCache( conversationState );
		}
	}

	if ( isRecord( parsed.selectedConversationIdsByTargetKey ) ) {
		for ( const [ targetKey, conversationId ] of Object.entries(
			parsed.selectedConversationIdsByTargetKey
		) ) {
			if ( typeof conversationId === 'string' && conversationCache.has( conversationId ) ) {
				selectedConversationIdsByTargetKey.set( targetKey, conversationId );
			}
		}
	}

	if ( isRecord( parsed.hiddenRemoteConversationKeysByTargetKey ) ) {
		for ( const [ targetKey, hiddenKeys ] of Object.entries(
			parsed.hiddenRemoteConversationKeysByTargetKey
		) ) {
			if ( Array.isArray( hiddenKeys ) ) {
				hiddenRemoteConversationKeysByTargetKey.set(
					targetKey,
					new Set(
						hiddenKeys.filter( ( hiddenKey ): hiddenKey is string => typeof hiddenKey === 'string' )
					)
				);
			}
		}
	}

	return true;
};

export const loadWorkspaceDollyConversationCache = () => {
	if ( hasLoadedConversationCache ) {
		return;
	}

	hasLoadedConversationCache = true;
	const rawCache = localStorage.getItem( WORKSPACE_DOLLY_CONVERSATIONS_STORAGE_KEY );
	if ( ! rawCache ) {
		return;
	}

	try {
		loadPersistedWorkspaceDollyCache( JSON.parse( rawCache ) );
	} catch ( error ) {
		console.error( error );
	}
};

export const persistWorkspaceDollyConversationCache = () => {
	const cache: PersistedWorkspaceDollyCache = {
		version: 1,
		conversations: Object.fromEntries(
			Array.from( conversationCache.entries() ).map( ( [ key, value ] ) => [
				key,
				cloneWorkspaceDollyConversationState( value ),
			] )
		),
		selectedConversationIdsByTargetKey: Object.fromEntries(
			selectedConversationIdsByTargetKey.entries()
		),
		hiddenRemoteConversationKeysByTargetKey: Object.fromEntries(
			Array.from( hiddenRemoteConversationKeysByTargetKey.entries() ).map(
				( [ targetKey, hiddenKeys ] ) => [ targetKey, Array.from( hiddenKeys ) ]
			)
		),
	};
	localStorage.setItem( WORKSPACE_DOLLY_CONVERSATIONS_STORAGE_KEY, JSON.stringify( cache ) );
};

export const createWorkspaceDollyConversationState = ( {
	workspaceId,
	targetId,
	site,
}: WorkspaceDollyTargetDescriptor ): WorkspaceDollyConversationState => ( {
	id: createWorkspaceDollyConversationId(),
	key: {
		workspaceId,
		targetId,
		siteId: site.id,
		agentId: WORKSPACE_DOLLY_AGENT_ID,
	},
	remoteChatId: undefined,
	serverHydrationDisabled: true,
	input: '',
	messages: [],
	sessionId: undefined,
	lastUpdated: Date.now(),
} );

export const setSelectedWorkspaceDollyConversationId = (
	target: WorkspaceDollyTargetDescriptor,
	conversationId: string
) => {
	selectedConversationIdsByTargetKey.set(
		createWorkspaceDollyTargetCacheKey( target ),
		conversationId
	);
	persistWorkspaceDollyConversationCache();
};

export const createNewWorkspaceDollyConversation = ( target: WorkspaceDollyTargetDescriptor ) => {
	loadWorkspaceDollyConversationCache();
	const conversationState = createWorkspaceDollyConversationState( target );
	conversationCache.set( conversationState.id, conversationState );
	setSelectedWorkspaceDollyConversationId( target, conversationState.id );
	return cloneWorkspaceDollyConversationState( conversationState );
};

const conversationMatchesTarget = (
	conversationState: WorkspaceDollyConversationState,
	{ workspaceId, targetId, site }: WorkspaceDollyTargetDescriptor
) =>
	conversationState.key.workspaceId === workspaceId &&
	conversationState.key.targetId === targetId &&
	conversationState.key.siteId === site.id;

export const getWorkspaceDollyConversationsForTarget = (
	target: WorkspaceDollyTargetDescriptor
) => {
	loadWorkspaceDollyConversationCache();
	return Array.from( conversationCache.values() )
		.filter( ( conversationState ) => conversationMatchesTarget( conversationState, target ) )
		.filter( ( conversationState ) => ! isRemoteConversationHidden( conversationState ) )
		.sort( ( first, second ) => second.lastUpdated - first.lastUpdated )
		.map( cloneWorkspaceDollyConversationState );
};

export const getWorkspaceDollyConversationState = ( target: WorkspaceDollyTargetDescriptor ) => {
	loadWorkspaceDollyConversationCache();
	const targetKey = createWorkspaceDollyTargetCacheKey( target );
	const selectedConversationId = selectedConversationIdsByTargetKey.get( targetKey );
	const cachedConversationState = selectedConversationId
		? conversationCache.get( selectedConversationId )
		: undefined;

	if (
		! cachedConversationState ||
		! conversationMatchesTarget( cachedConversationState, target )
	) {
		return createNewWorkspaceDollyConversation( target );
	}

	return cloneWorkspaceDollyConversationState( cachedConversationState );
};

export const getCachedWorkspaceDollyConversationState = ( conversationId: string ) => {
	loadWorkspaceDollyConversationCache();
	const conversationState = conversationCache.get( conversationId );
	return conversationState ? cloneWorkspaceDollyConversationState( conversationState ) : undefined;
};

export const writeWorkspaceDollyConversationState = (
	conversationState: WorkspaceDollyConversationState
) => {
	loadWorkspaceDollyConversationCache();
	conversationCache.set( conversationState.id, conversationState );
	selectedConversationIdsByTargetKey.set(
		createWorkspaceDollyConversationTargetCacheKey( conversationState ),
		conversationState.id
	);
	persistWorkspaceDollyConversationCache();
	return cloneWorkspaceDollyConversationState( conversationState );
};

export const deleteWorkspaceDollyConversation = (
	conversationId: string,
	target: WorkspaceDollyTargetDescriptor
) => {
	loadWorkspaceDollyConversationCache();
	const conversationState = conversationCache.get( conversationId );
	if ( conversationState && conversationMatchesTarget( conversationState, target ) ) {
		addHiddenRemoteConversation( conversationState );
		conversationCache.delete( conversationId );
	}

	const conversations = getWorkspaceDollyConversationsForTarget( target );
	const nextConversation = conversations[ 0 ];
	if ( nextConversation ) {
		setSelectedWorkspaceDollyConversationId( target, nextConversation.id );
		return nextConversation;
	}

	return createNewWorkspaceDollyConversation( target );
};

export const shouldApplyWorkspaceDollyHydration = (
	currentConversationState: WorkspaceDollyConversationState,
	hydratedConversationState: WorkspaceDollyConversationState
) => {
	const remoteChatMatches =
		currentConversationState.remoteChatId !== undefined &&
		currentConversationState.remoteChatId === hydratedConversationState.remoteChatId;
	const currentSessionId = normalizeDollySessionId( currentConversationState.sessionId );
	const hydratedSessionId = normalizeDollySessionId( hydratedConversationState.sessionId );
	const sessionMatches =
		currentSessionId !== undefined &&
		hydratedSessionId !== undefined &&
		currentSessionId === hydratedSessionId;

	if (
		currentConversationState.serverHydrationDisabled &&
		! remoteChatMatches &&
		! sessionMatches
	) {
		return false;
	}

	if ( currentConversationState.messages.length === 0 ) {
		return true;
	}

	if ( remoteChatMatches || sessionMatches ) {
		return true;
	}

	if ( currentConversationState.input.trim() ) {
		return false;
	}

	if ( currentConversationState.remoteChatId === undefined ) {
		return true;
	}

	return hydratedConversationState.lastUpdated > currentConversationState.lastUpdated;
};

export const mergeWorkspaceDollyConversationState = (
	hydratedConversationState: WorkspaceDollyConversationState,
	{ selectIfEmpty = false }: { selectIfEmpty?: boolean } = {}
) => {
	loadWorkspaceDollyConversationCache();
	if ( isRemoteConversationHidden( hydratedConversationState ) ) {
		return cloneWorkspaceDollyConversationState( hydratedConversationState );
	}

	const matchingConversation = Array.from( conversationCache.values() ).find( ( candidate ) => {
		if (
			candidate.key.workspaceId !== hydratedConversationState.key.workspaceId ||
			candidate.key.targetId !== hydratedConversationState.key.targetId ||
			candidate.key.siteId !== hydratedConversationState.key.siteId
		) {
			return false;
		}

		if (
			candidate.remoteChatId !== undefined &&
			candidate.remoteChatId === hydratedConversationState.remoteChatId
		) {
			return true;
		}

		const candidateSessionId = normalizeDollySessionId( candidate.sessionId );
		const hydratedSessionId = normalizeDollySessionId( hydratedConversationState.sessionId );
		return (
			candidateSessionId !== undefined &&
			hydratedSessionId !== undefined &&
			candidateSessionId === hydratedSessionId
		);
	} );
	const currentConversationState = matchingConversation
		? cloneWorkspaceDollyConversationState( matchingConversation )
		: undefined;
	const nextConversationState = currentConversationState
		? {
				...hydratedConversationState,
				id: currentConversationState.id,
				input: currentConversationState.input,
		  }
		: hydratedConversationState;

	if (
		currentConversationState &&
		! shouldApplyWorkspaceDollyHydration( currentConversationState, hydratedConversationState )
	) {
		return currentConversationState;
	}

	conversationCache.set( nextConversationState.id, nextConversationState );

	const targetKey = createWorkspaceDollyConversationTargetCacheKey( nextConversationState );
	const selectedConversationId = selectedConversationIdsByTargetKey.get( targetKey );
	const selectedConversation = selectedConversationId
		? conversationCache.get( selectedConversationId )
		: undefined;
	if (
		! selectedConversation ||
		( selectIfEmpty &&
			selectedConversation.messages.length === 0 &&
			! selectedConversation.input.trim() )
	) {
		selectedConversationIdsByTargetKey.set( targetKey, nextConversationState.id );
	}

	persistWorkspaceDollyConversationCache();
	return cloneWorkspaceDollyConversationState( nextConversationState );
};

export const clearWorkspaceDollyAssistantStateCacheForTests = () => {
	conversationCache.clear();
	selectedConversationIdsByTargetKey.clear();
	hiddenRemoteConversationKeysByTargetKey.clear();
	clearWorkspaceDollyTargetActivityForTests();
	hasLoadedConversationCache = false;
	localStorage.removeItem( WORKSPACE_DOLLY_CONVERSATIONS_STORAGE_KEY );
};
