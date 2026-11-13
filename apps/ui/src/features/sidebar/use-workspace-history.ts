import { useRouter, type RouterHistory } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import { useSessions } from '@/data/queries/use-sessions';
import { useSites } from '@/data/queries/use-sites';

type Location = RouterHistory[ 'location' ];

function createWorkspaceHistory( history: RouterHistory ) {
	let snapshot = { location: history.location, entries: [ history.location ] };
	const listeners = new Set< () => void >();
	let unsubscribe: ( () => void ) | undefined;

	const record = ( location: Location, push = false ) => {
		const index = location.state.__TSR_index;
		const entries = snapshot.entries.filter( ( entry ) =>
			push ? entry.state.__TSR_index < index : entry.state.__TSR_index !== index
		);
		entries.push( location );
		entries.sort( ( a, b ) => a.state.__TSR_index - b.state.__TSR_index );
		snapshot = { location, entries };
	};

	return {
		getSnapshot: () => snapshot,
		subscribe: ( listener: () => void ) => {
			listeners.add( listener );
			if ( ! unsubscribe ) {
				if ( snapshot.location !== history.location ) record( history.location );
				unsubscribe = history.subscribe( ( { location, action } ) => {
					record( location, action.type === 'PUSH' );
					listeners.forEach( ( notify ) => notify() );
				} );
			}
			return () => {
				listeners.delete( listener );
				if ( ! listeners.size ) {
					unsubscribe?.();
					unsubscribe = undefined;
				}
			};
		},
	};
}

const histories = new WeakMap< RouterHistory, ReturnType< typeof createWorkspaceHistory > >();

function hasDialog( location: Location ) {
	const search = new URLSearchParams( location.search );
	return [ 'settings', 'addSite', 'welcome', 'feedback', 'pin' ].some( ( key ) =>
		search.has( key )
	);
}

export function useWorkspaceHistory() {
	const { history } = useRouter();
	let store = histories.get( history );
	if ( ! store ) {
		store = createWorkspaceHistory( history );
		histories.set( history, store );
	}
	const { location, entries } = useSyncExternalStore( store.subscribe, store.getSnapshot );
	const { data: sites } = useSites();
	const { data: sessions } = useSessions();
	const index = location.state.__TSR_index;

	const available = entries.filter( ( entry ) => {
		if ( hasDialog( entry ) || entry.pathname === location.pathname ) return false;
		const site = /^\/sites\/([^/]+)(?:\/new)?\/?$/.exec( entry.pathname );
		if ( site ) return sites?.some( ( item ) => item.id === decodeURIComponent( site[ 1 ] ) );
		const chat = /^\/sessions\/([^/]+)\/?$/.exec( entry.pathname );
		return (
			chat &&
			sessions?.some( ( item ) => item.id === decodeURIComponent( chat[ 1 ] ) && ! item.archived )
		);
	} );
	const back = [ ...available ].reverse().find( ( entry ) => entry.state.__TSR_index < index );
	const forward = available.find( ( entry ) => entry.state.__TSR_index > index );
	const go = ( target: Location | undefined ) => {
		if ( target ) history.go( target.state.__TSR_index - history.location.state.__TSR_index );
	};

	return {
		canGoBack: !! back,
		canGoForward: !! forward,
		goBack: () => go( back ),
		goForward: () => go( forward ),
	};
}
