import { useSyncExternalStore } from 'react';

let paletteOpen = false;
const listeners = new Set< () => void >();

function subscribe( listener: () => void ) {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

export function setCommandPaletteOpen( next: boolean ) {
	if ( paletteOpen !== next ) {
		paletteOpen = next;
		listeners.forEach( ( listener ) => listener() );
	}
}

export function useCommandPaletteOpen() {
	return useSyncExternalStore(
		subscribe,
		() => paletteOpen,
		() => false
	);
}
