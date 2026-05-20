import { useMemo, useSyncExternalStore } from 'react';
import { clearWorkspaceDollyWorkspaceActivityForTests } from 'src/modules/workspaces/lib/dolly/turns';
import {
	WORKSPACE_DOLLY_AGENT_ID,
	type WorkspaceDollyConversationState,
	type WorkspaceDollyWorkspaceDescriptor,
} from 'src/modules/workspaces/lib/dolly/types';
import {
	flexibleNumber,
	isRecord,
	normalizeDollySessionId,
} from 'src/modules/workspaces/lib/dolly/utils';
import type { RemoteTarget, StudioWorkspace } from 'src/modules/workspaces/types';
import type { Message as MessageType } from 'src/stores/chat-slice';

export const WORKSPACE_DOLLY_CONVERSATIONS_STORAGE_KEY = 'studio_workspace_dolly_conversations_v2';

type PersistedWorkspaceDollyCache = {
	version: 2;
	conversations: Record< string, WorkspaceDollyConversationState >;
	selectedConversationIdsByWorkspaceId: Record< string, string >;
	hiddenRemoteConversationKeysByWorkspaceId: Record< string, string[] >;
};

const conversationCache = new Map< string, WorkspaceDollyConversationState >();
const selectedConversationIdsByWorkspaceId = new Map< string, string >();
const hiddenRemoteConversationKeysByWorkspaceId = new Map< string, Set< string > >();
const conversationCacheSubscribers = new Set< () => void >();
let hasLoadedConversationCache = false;
let conversationCacheVersion = 0;

const emitConversationCacheChange = () => {
	conversationCacheVersion += 1;
	for ( const subscriber of conversationCacheSubscribers ) {
		subscriber();
	}
};

const subscribeWorkspaceDollyConversationCache = ( subscriber: () => void ) => {
	conversationCacheSubscribers.add( subscriber );
	return () => {
		conversationCacheSubscribers.delete( subscriber );
	};
};

const getWorkspaceDollyConversationCacheSnapshot = () => {
	loadWorkspaceDollyConversationCache();
	return conversationCacheVersion;
};

export const createWorkspaceDollyWorkspaceCacheKey = ( {
	workspaceId,
}: WorkspaceDollyWorkspaceDescriptor ) => workspaceId;

export const createWorkspaceDollyWorkspaceDescriptor = (
	workspace: StudioWorkspace
): WorkspaceDollyWorkspaceDescriptor => ( {
	workspaceId: workspace.id,
	workspace,
	remoteTargets: [ workspace.targets.production, workspace.targets.staging ].filter(
		( target ): target is RemoteTarget => Boolean( target )
	),
} );

const createWorkspaceDollyConversationWorkspaceCacheKey = (
	conversationState: WorkspaceDollyConversationState
) => conversationState.key.workspaceId;

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
	const hiddenKeys = hiddenRemoteConversationKeysByWorkspaceId.get(
		createWorkspaceDollyConversationWorkspaceCacheKey( conversationState )
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

	const workspaceId = createWorkspaceDollyConversationWorkspaceCacheKey( conversationState );
	const hiddenKeys =
		hiddenRemoteConversationKeysByWorkspaceId.get( workspaceId ) ?? new Set< string >();
	keys.forEach( ( key ) => hiddenKeys.add( key ) );
	hiddenRemoteConversationKeysByWorkspaceId.set( workspaceId, hiddenKeys );
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
	const agentId = typeof value.key.agentId === 'string' ? value.key.agentId : undefined;

	if ( ! workspaceId || agentId !== WORKSPACE_DOLLY_AGENT_ID ) {
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

	const workspaceId = createWorkspaceDollyConversationWorkspaceCacheKey( conversationState );
	if ( ! selectedConversationIdsByWorkspaceId.has( workspaceId ) ) {
		selectedConversationIdsByWorkspaceId.set( workspaceId, conversationState.id );
	}
};

const loadPersistedWorkspaceDollyCache = ( parsed: unknown ) => {
	if ( ! isRecord( parsed ) || parsed.version !== 2 || ! isRecord( parsed.conversations ) ) {
		return false;
	}

	for ( const value of Object.values( parsed.conversations ) ) {
		const conversationState = normalizePersistedWorkspaceDollyConversationState( value );
		if ( conversationState ) {
			addConversationStateToCache( conversationState );
		}
	}

	if ( isRecord( parsed.selectedConversationIdsByWorkspaceId ) ) {
		for ( const [ workspaceId, conversationId ] of Object.entries(
			parsed.selectedConversationIdsByWorkspaceId
		) ) {
			if ( typeof conversationId === 'string' && conversationCache.has( conversationId ) ) {
				selectedConversationIdsByWorkspaceId.set( workspaceId, conversationId );
			}
		}
	}

	if ( isRecord( parsed.hiddenRemoteConversationKeysByWorkspaceId ) ) {
		for ( const [ workspaceId, hiddenKeys ] of Object.entries(
			parsed.hiddenRemoteConversationKeysByWorkspaceId
		) ) {
			if ( Array.isArray( hiddenKeys ) ) {
				hiddenRemoteConversationKeysByWorkspaceId.set(
					workspaceId,
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
		version: 2,
		conversations: Object.fromEntries(
			Array.from( conversationCache.entries() ).map( ( [ key, value ] ) => [
				key,
				cloneWorkspaceDollyConversationState( value ),
			] )
		),
		selectedConversationIdsByWorkspaceId: Object.fromEntries(
			selectedConversationIdsByWorkspaceId.entries()
		),
		hiddenRemoteConversationKeysByWorkspaceId: Object.fromEntries(
			Array.from( hiddenRemoteConversationKeysByWorkspaceId.entries() ).map(
				( [ workspaceId, hiddenKeys ] ) => [ workspaceId, Array.from( hiddenKeys ) ]
			)
		),
	};
	localStorage.setItem( WORKSPACE_DOLLY_CONVERSATIONS_STORAGE_KEY, JSON.stringify( cache ) );
	emitConversationCacheChange();
};

export const createWorkspaceDollyConversationState = ( {
	workspaceId,
}: WorkspaceDollyWorkspaceDescriptor ): WorkspaceDollyConversationState => ( {
	id: createWorkspaceDollyConversationId(),
	key: {
		workspaceId,
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
	workspace: WorkspaceDollyWorkspaceDescriptor,
	conversationId: string
) => {
	selectedConversationIdsByWorkspaceId.set(
		createWorkspaceDollyWorkspaceCacheKey( workspace ),
		conversationId
	);
	persistWorkspaceDollyConversationCache();
};

export const createNewWorkspaceDollyConversation = (
	workspace: WorkspaceDollyWorkspaceDescriptor
) => {
	loadWorkspaceDollyConversationCache();
	const conversationState = createWorkspaceDollyConversationState( workspace );
	conversationCache.set( conversationState.id, conversationState );
	setSelectedWorkspaceDollyConversationId( workspace, conversationState.id );
	return cloneWorkspaceDollyConversationState( conversationState );
};

const conversationMatchesWorkspace = (
	conversationState: WorkspaceDollyConversationState,
	{ workspaceId }: WorkspaceDollyWorkspaceDescriptor
) => conversationState.key.workspaceId === workspaceId;

export const getWorkspaceDollyConversationsForWorkspace = (
	workspace: WorkspaceDollyWorkspaceDescriptor
) => {
	loadWorkspaceDollyConversationCache();
	return Array.from( conversationCache.values() )
		.filter( ( conversationState ) => conversationMatchesWorkspace( conversationState, workspace ) )
		.filter( ( conversationState ) => ! isRemoteConversationHidden( conversationState ) )
		.sort( ( first, second ) => second.lastUpdated - first.lastUpdated )
		.map( cloneWorkspaceDollyConversationState );
};

export const getSelectedWorkspaceDollyConversationId = (
	workspace: WorkspaceDollyWorkspaceDescriptor
) => {
	loadWorkspaceDollyConversationCache();
	return selectedConversationIdsByWorkspaceId.get(
		createWorkspaceDollyWorkspaceCacheKey( workspace )
	);
};

export const getWorkspaceDollyConversationState = (
	workspace: WorkspaceDollyWorkspaceDescriptor
) => {
	loadWorkspaceDollyConversationCache();
	const workspaceId = createWorkspaceDollyWorkspaceCacheKey( workspace );
	const selectedConversationId = selectedConversationIdsByWorkspaceId.get( workspaceId );
	const cachedConversationState = selectedConversationId
		? conversationCache.get( selectedConversationId )
		: undefined;

	if (
		! cachedConversationState ||
		! conversationMatchesWorkspace( cachedConversationState, workspace )
	) {
		return createNewWorkspaceDollyConversation( workspace );
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
	selectedConversationIdsByWorkspaceId.set(
		createWorkspaceDollyConversationWorkspaceCacheKey( conversationState ),
		conversationState.id
	);
	persistWorkspaceDollyConversationCache();
	return cloneWorkspaceDollyConversationState( conversationState );
};

export const deleteWorkspaceDollyConversation = (
	conversationId: string,
	workspace: WorkspaceDollyWorkspaceDescriptor
) => {
	loadWorkspaceDollyConversationCache();
	const conversationState = conversationCache.get( conversationId );
	if ( conversationState && conversationMatchesWorkspace( conversationState, workspace ) ) {
		addHiddenRemoteConversation( conversationState );
		conversationCache.delete( conversationId );
	}

	const conversations = getWorkspaceDollyConversationsForWorkspace( workspace );
	const nextConversation = conversations[ 0 ];
	if ( nextConversation ) {
		setSelectedWorkspaceDollyConversationId( workspace, nextConversation.id );
		return nextConversation;
	}

	return createNewWorkspaceDollyConversation( workspace );
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
		if ( candidate.key.workspaceId !== hydratedConversationState.key.workspaceId ) {
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

	const workspaceId = createWorkspaceDollyConversationWorkspaceCacheKey( nextConversationState );
	const selectedConversationId = selectedConversationIdsByWorkspaceId.get( workspaceId );
	const selectedConversation = selectedConversationId
		? conversationCache.get( selectedConversationId )
		: undefined;
	if (
		! selectedConversation ||
		( selectIfEmpty &&
			selectedConversation.messages.length === 0 &&
			! selectedConversation.input.trim() )
	) {
		selectedConversationIdsByWorkspaceId.set( workspaceId, nextConversationState.id );
	}

	persistWorkspaceDollyConversationCache();
	return cloneWorkspaceDollyConversationState( nextConversationState );
};

export const clearWorkspaceDollyAssistantStateCacheForTests = () => {
	conversationCache.clear();
	selectedConversationIdsByWorkspaceId.clear();
	hiddenRemoteConversationKeysByWorkspaceId.clear();
	clearWorkspaceDollyWorkspaceActivityForTests();
	hasLoadedConversationCache = false;
	localStorage.removeItem( WORKSPACE_DOLLY_CONVERSATIONS_STORAGE_KEY );
	emitConversationCacheChange();
};

export const useWorkspaceDollyConversationsForWorkspace = (
	workspace: WorkspaceDollyWorkspaceDescriptor
) => {
	const version = useSyncExternalStore(
		subscribeWorkspaceDollyConversationCache,
		getWorkspaceDollyConversationCacheSnapshot,
		() => 0
	);

	return useMemo( () => {
		void version;
		return getWorkspaceDollyConversationsForWorkspace( workspace );
	}, [ version, workspace ] );
};

export const useSelectedWorkspaceDollyConversationId = (
	workspace: WorkspaceDollyWorkspaceDescriptor
) => {
	const version = useSyncExternalStore(
		subscribeWorkspaceDollyConversationCache,
		getWorkspaceDollyConversationCacheSnapshot,
		() => 0
	);

	return useMemo( () => {
		void version;
		return getSelectedWorkspaceDollyConversationId( workspace );
	}, [ version, workspace ] );
};
