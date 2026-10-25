import { useSyncExternalStore } from 'react';
import { isShortcut } from '@/lib/keyboard';
import type { KeyboardEvent } from 'react';

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

// ⌘K in a dialog the palette takes over from, such as Settings: closes the
// dialog and opens the palette. A dialog opened over it keeps the key.
export function closeOnPaletteShortcut( close: () => void ) {
	return ( event: KeyboardEvent< HTMLElement > ) => {
		if (
			! event.repeat &&
			isShortcut( event.nativeEvent, 'k' ) &&
			event.currentTarget.contains( event.target as Node )
		) {
			event.preventDefault();
			close();
			setCommandPaletteOpen( true );
		}
	};
}
