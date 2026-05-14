import { useSyncExternalStore } from 'react';

type WpcomSiteAssistantTurn = {
	sessionKey: string;
	siteId: number;
	abortController: AbortController;
};

const activeTurns = new Map< string, WpcomSiteAssistantTurn >();
const subscribers = new Set< () => void >();

const emitChange = () => {
	for ( const subscriber of subscribers ) {
		subscriber();
	}
};

const subscribeToTurns = ( subscriber: () => void ) => {
	subscribers.add( subscriber );
	return () => {
		subscribers.delete( subscriber );
	};
};

export const getWpcomSiteAssistantTurn = ( sessionKey: string ) => activeTurns.get( sessionKey );

export const startWpcomSiteAssistantTurn = ( turn: WpcomSiteAssistantTurn ) => {
	activeTurns.set( turn.sessionKey, turn );
	emitChange();
};

export const finishWpcomSiteAssistantTurn = (
	sessionKey: string,
	abortController: AbortController
) => {
	const activeTurn = activeTurns.get( sessionKey );
	if ( activeTurn?.abortController !== abortController ) {
		return;
	}

	activeTurns.delete( sessionKey );
	emitChange();
};

export const abortWpcomSiteAssistantTurn = ( sessionKey: string ) => {
	activeTurns.get( sessionKey )?.abortController.abort();
};

export const clearWpcomSiteAssistantTurnsForTests = () => {
	activeTurns.clear();
	emitChange();
};

export const useWpcomSiteAssistantTurn = ( sessionKey: string ) =>
	useSyncExternalStore(
		subscribeToTurns,
		() => Boolean( activeTurns.get( sessionKey ) ),
		() => false
	);
