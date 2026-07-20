import { __ } from '@wordpress/i18n';
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

export type SyncPhase = 'preparing' | 'uploading' | 'creating-backup' | 'applying' | 'finishing';

export type SyncPendingDetails = {
	phase?: SyncPhase;
	progress?: number | null;
	remoteSiteId?: number;
};

export type SyncLogEntry = {
	timestamp: string;
	message: string;
};

type SyncActivityLog = {
	log?: SyncLogEntry[];
};

export type SyncActivity =
	| ( { kind: 'pending'; direction: SyncDirection } & SyncPendingDetails & SyncActivityLog )
	| ( { kind: 'success'; direction: SyncDirection } & SyncActivityLog )
	| ( { kind: 'error'; direction: SyncDirection; message: string } & SyncActivityLog );

export type SyncLogSummary = {
	kind: 'success' | 'error';
	direction: SyncDirection;
	completedAt: string;
	message?: string;
	log: SyncLogEntry[];
};

type SyncPendingUpdate = SyncPendingDetails & {
	logMessage?: string;
};

// How long success/error stay visible before the indicator vanishes.
// Matches the 30s requirement from the UX spec.
const RESULT_TTL_MS = 30_000;
const MAX_LOG_ENTRIES = 50;

const entries = new Map< string, SyncActivity >();
const lastLogs = new Map< string, SyncLogSummary >();
const timers = new Map< string, ReturnType< typeof setTimeout > >();
const listeners = new Set< () => void >();
const eventListeners = new Set< ( event: SyncActivityEvent ) => void >();

export type SyncActivityEvent = 'sync-started' | 'sync-complete' | 'sync-failed';

function emitEvent( event: SyncActivityEvent ) {
	for ( const listener of eventListeners ) {
		listener( event );
	}
}

let snapshot: ReadonlyMap< string, SyncActivity > = entries;
let lastLogSnapshot: ReadonlyMap< string, SyncLogSummary > = lastLogs;

function emit() {
	// useSyncExternalStore compares snapshot references, so rebuild the map
	// instead of mutating the existing reference.
	snapshot = new Map( entries );
	lastLogSnapshot = new Map( lastLogs );
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

function appendLogEntry( log: SyncLogEntry[] | undefined, message: string ): SyncLogEntry[] {
	const lastEntry = log?.[ log.length - 1 ];
	if ( lastEntry?.message === message ) {
		return log ?? [];
	}

	return [
		...( log ?? [] ),
		{
			timestamp: new Date().toISOString(),
			message,
		},
	].slice( -MAX_LOG_ENTRIES );
}

export function reportSyncPending(
	siteId: string,
	direction: SyncDirection,
	details: SyncPendingUpdate = {}
): void {
	const current = entries.get( siteId );
	const isStarting = current?.kind !== 'pending';
	const { logMessage, ...pendingDetails } = details;
	const log = logMessage ? appendLogEntry( current?.log, logMessage ) : current?.log;

	clearExpiryTimer( siteId );
	entries.set( siteId, { kind: 'pending', direction, ...pendingDetails, log } );
	emit();
	if ( isStarting ) {
		emitEvent( 'sync-started' );
	}
}

export function updateSyncPending( siteId: string, details: SyncPendingUpdate ): void {
	const current = entries.get( siteId );
	if ( ! current || current.kind !== 'pending' ) {
		return;
	}

	const { logMessage, ...pendingDetails } = details;
	const log = logMessage ? appendLogEntry( current.log, logMessage ) : current.log;

	entries.set( siteId, { ...current, ...pendingDetails, log } );
	emit();
}

export function reportSyncSuccess( siteId: string, direction: SyncDirection ): void {
	const current = entries.get( siteId );
	const isNewResult = current?.kind !== 'success';
	const log = appendLogEntry( current?.log, __( 'Sync completed.' ) );
	entries.set( siteId, {
		kind: 'success',
		direction,
		log,
	} );
	lastLogs.set( siteId, {
		kind: 'success',
		direction,
		completedAt: new Date().toISOString(),
		log,
	} );
	scheduleExpiry( siteId );
	emit();
	if ( isNewResult ) {
		emitEvent( 'sync-complete' );
	}
}

export function reportSyncError( siteId: string, direction: SyncDirection, message: string ): void {
	const current = entries.get( siteId );
	const isNewResult = current?.kind !== 'error';
	const log = appendLogEntry( current?.log, message );
	entries.set( siteId, {
		kind: 'error',
		direction,
		message,
		log,
	} );
	lastLogs.set( siteId, {
		kind: 'error',
		direction,
		completedAt: new Date().toISOString(),
		message,
		log,
	} );
	scheduleExpiry( siteId );
	emit();
	if ( isNewResult ) {
		emitEvent( 'sync-failed' );
	}
}

export function subscribeToSyncActivityEvents(
	listener: ( event: SyncActivityEvent ) => void
): () => void {
	eventListeners.add( listener );
	return () => eventListeners.delete( listener );
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

export function useSiteLastSyncLog( siteId: string | undefined ): SyncLogSummary | null {
	return useSyncExternalStore(
		subscribe,
		() => ( siteId ? lastLogSnapshot.get( siteId ) ?? null : null ),
		() => null
	);
}
