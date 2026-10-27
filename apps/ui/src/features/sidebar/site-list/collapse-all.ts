import { useEffect, useSyncExternalStore } from 'react';

// Set while more than one site shows its chats, so the command palette can
// fold them like the sidebar's Collapse all.
let collapseAll: ( () => void ) | undefined;
const listeners = new Set< () => void >();

function subscribe( listener: () => void ) {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

function set( next: ( () => void ) | undefined ) {
	collapseAll = next;
	listeners.forEach( ( listener ) => listener() );
}

export function useProvideCollapseAll( action: ( () => void ) | undefined ) {
	useEffect( () => {
		if ( ! action ) {
			return;
		}
		set( action );
		return () => set( undefined );
	}, [ action ] );
}

export function useCollapseAll() {
	return useSyncExternalStore(
		subscribe,
		() => collapseAll,
		() => undefined
	);
}
