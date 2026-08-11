import { useSyncExternalStore } from 'react';

// Dev-only "message lab" sidebar-indicator override (see
// components/dev-message-lab). Module-level store, same shape as
// dev-lab-messages.ts: the lab (dev-gated) is the only writer; the sidebar's
// site rows always read it, which resolves to 'auto' (no override) in
// production.

export type ForcedActivity =
	| 'auto'
	| 'idle'
	| 'working'
	| 'pending-question'
	| 'new-message'
	| 'sync';

const overrides = new Map< string, ForcedActivity >();
const listeners = new Set< () => void >();

function notify() {
	listeners.forEach( ( listener ) => listener() );
}

export function setSiteActivityOverride( siteId: string, value: ForcedActivity ): void {
	if ( value === 'auto' ) {
		overrides.delete( siteId );
	} else {
		overrides.set( siteId, value );
	}
	notify();
}

function subscribe( listener: () => void ) {
	listeners.add( listener );
	return () => listeners.delete( listener );
}

export function useSiteActivityOverride( siteId: string ): ForcedActivity {
	return useSyncExternalStore( subscribe, () => overrides.get( siteId ) ?? 'auto' );
}
