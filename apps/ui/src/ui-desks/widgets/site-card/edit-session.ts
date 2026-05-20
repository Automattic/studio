import { useSyncExternalStore } from 'react';

export type SiteCardEditAction = 'save' | 'cancel';

export interface SiteCardEditSession {
	isDirty: boolean;
	isSaving: boolean;
	canSave: boolean;
	requestAction: ( action: SiteCardEditAction ) => void;
}

const emptySiteCardEditSession: SiteCardEditSession = {
	isDirty: false,
	isSaving: false,
	canSave: false,
	requestAction: () => undefined,
};

const sessions = new Map< string, SiteCardEditSession >();
const listeners = new Set< () => void >();

export function registerSiteCardEditSession( widgetId: string, session: SiteCardEditSession ) {
	sessions.set( widgetId, session );
	emitChange();

	return () => {
		if ( sessions.get( widgetId ) === session ) {
			sessions.delete( widgetId );
			emitChange();
		}
	};
}

export function useSiteCardEditSession( widgetId: string | null ) {
	return useSyncExternalStore(
		subscribe,
		() => getSiteCardEditSession( widgetId ),
		() => emptySiteCardEditSession
	);
}

function getSiteCardEditSession( widgetId: string | null ) {
	return widgetId ? sessions.get( widgetId ) ?? emptySiteCardEditSession : emptySiteCardEditSession;
}

function subscribe( listener: () => void ) {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

function emitChange() {
	for ( const listener of listeners ) {
		listener();
	}
}
