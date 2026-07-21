import { useSyncExternalStore } from 'react';

function subscribe( callback: () => void ) {
	window.addEventListener( 'online', callback );
	window.addEventListener( 'offline', callback );
	return () => {
		window.removeEventListener( 'online', callback );
		window.removeEventListener( 'offline', callback );
	};
}

export function useOffline(): boolean {
	return useSyncExternalStore( subscribe, () => ! navigator.onLine );
}
