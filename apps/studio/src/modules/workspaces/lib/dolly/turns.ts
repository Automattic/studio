import { useMemo, useSyncExternalStore } from 'react';
import type { WorkspaceDollyWorkspaceActivity } from 'src/modules/workspaces/lib/dolly/types';

type WorkspaceDollyTurn = {
	conversationId: string;
	workspaceId: string;
	abortController: AbortController;
};

const activeTurns = new Map< string, WorkspaceDollyTurn >();
const workspaceActivities = new Map< string, WorkspaceDollyWorkspaceActivity >();
const subscribers = new Set< () => void >();
let activityVersion = 0;

const emitChange = () => {
	activityVersion += 1;
	for ( const subscriber of subscribers ) {
		subscriber();
	}
};

const subscribe = ( subscriber: () => void ) => {
	subscribers.add( subscriber );
	return () => {
		subscribers.delete( subscriber );
	};
};

const setWorkspaceActivity = (
	workspaceId: string,
	activity: Partial< WorkspaceDollyWorkspaceActivity >
) => {
	const nextActivity = {
		...workspaceActivities.get( workspaceId ),
		...activity,
	};
	const hasActiveActivity = Object.values( nextActivity ).some( Boolean );

	if ( hasActiveActivity ) {
		workspaceActivities.set( workspaceId, nextActivity );
	} else {
		workspaceActivities.delete( workspaceId );
	}
	emitChange();
};

const refreshThinkingActivity = ( workspaceId: string ) => {
	const hasActiveTurn = Array.from( activeTurns.values() ).some(
		( turn ) => turn.workspaceId === workspaceId
	);
	setWorkspaceActivity( workspaceId, { isAssistantThinking: hasActiveTurn } );
};

export const getWorkspaceDollyTurn = ( conversationId: string ) =>
	activeTurns.get( conversationId );

export const startWorkspaceDollyTurn = ( turn: WorkspaceDollyTurn ) => {
	activeTurns.set( turn.conversationId, turn );
	setWorkspaceActivity( turn.workspaceId, { isAssistantThinking: true } );
};

export const finishWorkspaceDollyTurn = (
	conversationId: string,
	abortController: AbortController
) => {
	const activeTurn = activeTurns.get( conversationId );
	if ( activeTurn?.abortController !== abortController ) {
		return;
	}

	activeTurns.delete( conversationId );
	refreshThinkingActivity( activeTurn.workspaceId );
};

export const abortWorkspaceDollyTurn = ( conversationId: string ) => {
	activeTurns.get( conversationId )?.abortController.abort();
};

export const setWorkspaceDollyWorkspaceUnread = (
	workspaceId: string,
	hasUnreadAssistantMessage: boolean
) => {
	setWorkspaceActivity( workspaceId, { hasUnreadAssistantMessage } );
};

export const clearWorkspaceDollyWorkspaceActivityForTests = () => {
	activeTurns.clear();
	workspaceActivities.clear();
	emitChange();
};

export const useWorkspaceDollyConversationTurn = ( conversationId: string ) =>
	useSyncExternalStore(
		subscribe,
		() => Boolean( activeTurns.get( conversationId ) ),
		() => false
	);

export const useWorkspaceDollyWorkspaceActivity = ( workspaceId: string ) => {
	const version = useSyncExternalStore(
		subscribe,
		() => activityVersion,
		() => 0
	);

	return useMemo( () => {
		void version;
		return { ...workspaceActivities.get( workspaceId ) };
	}, [ version, workspaceId ] );
};
