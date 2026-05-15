import { useMemo, useSyncExternalStore } from 'react';
import type { WorkspaceDollyTargetActivity } from 'src/modules/workspaces/lib/dolly/types';
import type { RemoteTargetId } from 'src/modules/workspaces/types';

type WorkspaceDollyTurn = {
	conversationId: string;
	workspaceId: string;
	targetId: RemoteTargetId;
	siteId: number;
	abortController: AbortController;
};

const activeTurns = new Map< string, WorkspaceDollyTurn >();
const targetActivities = new Map< string, WorkspaceDollyTargetActivity >();
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

export const getWorkspaceDollyTargetActivityKey = ( {
	workspaceId,
	targetId,
	siteId,
}: {
	workspaceId: string;
	targetId: RemoteTargetId;
	siteId: number;
} ) => `${ workspaceId }:${ targetId }:${ siteId }`;

const setTargetActivity = (
	targetKey: string,
	activity: Partial< WorkspaceDollyTargetActivity >
) => {
	const nextActivity = {
		...targetActivities.get( targetKey ),
		...activity,
	};
	const hasActiveActivity = Object.values( nextActivity ).some( Boolean );

	if ( hasActiveActivity ) {
		targetActivities.set( targetKey, nextActivity );
	} else {
		targetActivities.delete( targetKey );
	}
	emitChange();
};

const refreshThinkingActivity = ( targetKey: string ) => {
	const hasActiveTurn = Array.from( activeTurns.values() ).some(
		( turn ) =>
			getWorkspaceDollyTargetActivityKey( {
				workspaceId: turn.workspaceId,
				targetId: turn.targetId,
				siteId: turn.siteId,
			} ) === targetKey
	);
	setTargetActivity( targetKey, { isAssistantThinking: hasActiveTurn } );
};

export const getWorkspaceDollyTurn = ( conversationId: string ) =>
	activeTurns.get( conversationId );

export const startWorkspaceDollyTurn = ( turn: WorkspaceDollyTurn ) => {
	activeTurns.set( turn.conversationId, turn );
	setTargetActivity(
		getWorkspaceDollyTargetActivityKey( {
			workspaceId: turn.workspaceId,
			targetId: turn.targetId,
			siteId: turn.siteId,
		} ),
		{ isAssistantThinking: true }
	);
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
	refreshThinkingActivity(
		getWorkspaceDollyTargetActivityKey( {
			workspaceId: activeTurn.workspaceId,
			targetId: activeTurn.targetId,
			siteId: activeTurn.siteId,
		} )
	);
};

export const abortWorkspaceDollyTurn = ( conversationId: string ) => {
	activeTurns.get( conversationId )?.abortController.abort();
};

export const setWorkspaceDollyTargetUnread = (
	target: { workspaceId: string; targetId: RemoteTargetId; siteId: number },
	hasUnreadAssistantMessage: boolean
) => {
	setTargetActivity( getWorkspaceDollyTargetActivityKey( target ), {
		hasUnreadAssistantMessage,
	} );
};

export const clearWorkspaceDollyTargetActivityForTests = () => {
	activeTurns.clear();
	targetActivities.clear();
	emitChange();
};

export const useWorkspaceDollyConversationTurn = ( conversationId: string ) =>
	useSyncExternalStore(
		subscribe,
		() => Boolean( activeTurns.get( conversationId ) ),
		() => false
	);

export const useWorkspaceDollyTargetActivities = ( workspaceId: string ) => {
	const version = useSyncExternalStore(
		subscribe,
		() => activityVersion,
		() => 0
	);

	return useMemo( () => {
		void version;
		const activities: Record< string, WorkspaceDollyTargetActivity > = {};
		for ( const [ key, activity ] of targetActivities.entries() ) {
			if ( key.startsWith( `${ workspaceId }:` ) ) {
				activities[ key ] = { ...activity };
			}
		}
		return activities;
	}, [ version, workspaceId ] );
};
