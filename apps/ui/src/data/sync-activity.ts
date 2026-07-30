import { useSyncExternalStore } from 'react';
import type { PullSiteProgress, PushSitePhase, PushSiteProgress } from '@/data/core';

// Tracks in-flight and recently completed live-site sync operations so the
// Site Details header can surface a cross-page indicator. Uses a module-
// level store (rather than React context) so the state survives component
// remounts during navigation — e.g. pushing from the session view and then
// switching to the site settings page still shows the in-progress icon.

// `preview` covers creating or refreshing the WordPress.com-hosted preview
// snapshot. Grouped in here alongside push/pull so the dropdown's single
// activity indicator can surface any live-sync-like operation consistently.
export type SyncDirection = 'push' | 'pull' | 'preview';

// `phase` is push-only: pull describes itself with a `message` from the CLI,
// while push reports which of its three stages it is in so the UI can label
// it without the backend owning user-facing copy.
export type SyncActivity =
	| {
			kind: 'pending';
			direction: SyncDirection;
			message?: string;
			progress?: number;
			phase?: PushSitePhase;
	  }
	// `at` is when the result landed, so the UI can age it ("3s", "4m") rather
	// than saying "just now" for as long as it stays on screen.
	| { kind: 'success'; direction: SyncDirection; at?: number }
	| { kind: 'error'; direction: SyncDirection; message: string; at?: number };

// How long a success stays visible before the indicator vanishes. Matches the
// 30s requirement from the UX spec. Errors have no TTL — they persist until
// the user acknowledges them (see `clearSyncActivity`), because a failed push
// that quietly evaporates leaves the site in a state nobody was told about.
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

export function reportPullProgress( siteId: string, progress: PullSiteProgress ): void {
	clearExpiryTimer( siteId );
	entries.set( siteId, { kind: 'pending', direction: 'pull', ...progress } );
	emit();
}

export function reportPushProgress( siteId: string, progress: PushSiteProgress ): void {
	clearExpiryTimer( siteId );
	entries.set( siteId, { kind: 'pending', direction: 'push', ...progress } );
	emit();
}

export function reportSyncSuccess( siteId: string, direction: SyncDirection ): void {
	entries.set( siteId, { kind: 'success', direction, at: Date.now() } );
	scheduleExpiry( siteId );
	emit();
}

export function reportSyncError( siteId: string, direction: SyncDirection, message: string ): void {
	clearExpiryTimer( siteId );
	entries.set( siteId, { kind: 'error', direction, message, at: Date.now() } );
	emit();
}

// Drops whatever the site is currently reporting. The toolbar calls this when
// the user acknowledges a failure — by opening its details or retrying — so a
// persistent error has a way out that isn't "succeed next time".
export function clearSyncActivity( siteId: string ): void {
	clearExpiryTimer( siteId );
	if ( entries.delete( siteId ) ) {
		emit();
	}
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
