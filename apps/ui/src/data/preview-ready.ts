import { useSyncExternalStore } from 'react';

// Sites whose new preview finished while nobody was looking at it, so the
// Share button can point at it until the link is opened or copied.
let ready = new Set< string >();
const listeners = new Set< () => void >();

function update( next: Set< string > ) {
	ready = next;
	listeners.forEach( ( listener ) => listener() );
}

export function markPreviewReady( siteId: string ) {
	update( new Set( ready ).add( siteId ) );
}

export function markPreviewSeen( siteId: string ) {
	if ( ready.has( siteId ) ) {
		const next = new Set( ready );
		next.delete( siteId );
		update( next );
	}
}

// A preview belongs to the account that published it.
export function clearPreviewReady() {
	if ( ready.size ) {
		update( new Set() );
	}
}

export function usePreviewReady( siteId: string ) {
	return useSyncExternalStore(
		( listener ) => {
			listeners.add( listener );
			return () => listeners.delete( listener );
		},
		() => ready.has( siteId ),
		() => false
	);
}
