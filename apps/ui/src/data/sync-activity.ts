import { useSyncExternalStore } from 'react';

// Tracks in-flight and recently completed live-site sync operations so the
// Site Details header can surface a cross-page indicator. Uses a module-
// level store (rather than React context) so the state survives component
// remounts during navigation — e.g. pushing from the session view and then
// switching to the site settings page still shows the in-progress icon.

// `preview` covers creating or refreshing the WordPress.com-hosted preview
// snapshot. Grouped in here alongside push/pull so the dropdown's single
// activity indicator can surface any live-sync-like operation consistently.
export type SyncDirection = 'push' | 'pull' | 'preview';

export type SyncActivity =
	| { kind: 'pending'; direction: SyncDirection }
	| { kind: 'success'; direction: SyncDirection }
	| { kind: 'error'; direction: SyncDirection; message: string };

// How long success/error stay visible before the indicator vanishes.
// Matches the 30s requirement from the UX spec.
const RESULT_TTL_MS = 30_000;

const entries = new Map< string, SyncActivity >();
const timers = new Map< string, ReturnType< typeof setTimeout > >();
const listeners = new Set< () => void >();

let snapshot: ReadonlyMap< string, SyncActivity > = entries;

function emit() {
	// useSyncExternalStore compares snapshot references, so rebuild the map
	// instead of mutating the existing reference.
	snapshot = new Map( entries );
	for ( const listener of listeners ) {
		listener();
	}
}

function clearExpiryTimer( siteId: string ) {
	const timer = timers.get( siteId );
	if ( timer ) {
		clearTimeout( timer );
		timers.delete( siteId );
	}
}

function scheduleExpiry( siteId: string ) {
	clearExpiryTimer( siteId );
	const timer = setTimeout( () => {
		timers.delete( siteId );
		entries.delete( siteId );
		emit();
	}, RESULT_TTL_MS );
	timers.set( siteId, timer );
}

export function reportSyncPending( siteId: string, direction: SyncDirection ): void {
	clearExpiryTimer( siteId );
	entries.set( siteId, { kind: 'pending', direction } );
	emit();
}

export function reportSyncSuccess( siteId: string, direction: SyncDirection ): void {
	entries.set( siteId, { kind: 'success', direction } );
	scheduleExpiry( siteId );
	emit();
}

export function reportSyncError( siteId: string, direction: SyncDirection, message: string ): void {
	entries.set( siteId, { kind: 'error', direction, message } );
	scheduleExpiry( siteId );
	emit();
}

function subscribe( listener: () => void ): () => void {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

export function useSiteSyncActivity( siteId: string | undefined ): SyncActivity | null {
	return useSyncExternalStore(
		subscribe,
		() => ( siteId ? snapshot.get( siteId ) ?? null : null ),
		() => null
	);
}
