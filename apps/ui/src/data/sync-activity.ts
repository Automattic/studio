import { canCancelPull, canCancelPush } from '@studio/common/lib/sync/cancel';
import { __, sprintf } from '@wordpress/i18n';
import { useSyncExternalStore } from 'react';
import type { PullSiteProgress, PushPhase } from '@/data/core';

// Structurally what `PullSiteProgress` already is, named for the wider set of
// operations that report through here.
export type ActivityProgress = PullSiteProgress;

// Tracks in-flight and recently completed live-site sync operations so the
// Site Details header can surface a cross-page indicator. Uses a module-
// level store (rather than React context) so the state survives component
// remounts during navigation — e.g. pushing from the session view and then
// switching to the site settings page still shows the in-progress icon.

// `preview` covers creating or refreshing the WordPress.com-hosted preview
// snapshot. Grouped in here alongside push/pull so the dropdown's single
// activity indicator can surface any live-sync-like operation consistently.
//
// `import` is not a live-site operation at all, but it is the same shape of
// thing from the UI's point of view: long-running, scoped to one site, and it
// rewrites that site underneath you. It lives here so a site being imported
// reads the same way in the sidebar and dropdown as one being pulled — and so
// two concurrent imports stay told apart by site, which a global toast can't do.
export type SyncDirection = 'push' | 'pull' | 'preview' | 'import';

export type SyncActivity =
	| {
			kind: 'pending';
			direction: SyncDirection;
			message?: string;
			progress?: number;
			// How far a push has got; drives the cancel gate. Pull reports the
			// equivalent through the CLI `action` behind its progress message.
			phase?: PushPhase;
			action?: string;
	  }
	| { kind: 'success'; direction: SyncDirection }
	| { kind: 'cancelled'; direction: SyncDirection }
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

export function reportSyncProgress(
	siteId: string,
	direction: Extract< SyncDirection, 'pull' | 'preview' | 'import' >,
	progress: ActivityProgress
): void {
	clearExpiryTimer( siteId );
	entries.set( siteId, { kind: 'pending', direction, ...progress } );
	emit();
}

// Same wording as the classic renderer's push states, so a user moving between
// the two UIs reads the same thing. The percentage goes in the message because
// that is how a pull already reads here — the CLI puts it in its own text.
function getPushPhaseMessage( phase: PushPhase, progress?: number ): string {
	const message = {
		creatingBackup: __( 'Creating backup…' ),
		uploading: __( 'Uploading site…' ),
		creatingRemoteBackup: __( 'Backing up remote site…' ),
		applyingChanges: __( 'Applying changes…' ),
		finishing: __( 'Almost there…' ),
	}[ phase ];

	return progress ? sprintf( '%1$s (%2$d%%)', message, Math.round( progress ) ) : message;
}

export function reportPushPhase( siteId: string, phase: PushPhase, progress?: number ): void {
	const current = entries.get( siteId );
	if ( current?.kind !== 'pending' || current.direction !== 'push' ) {
		return;
	}
	clearExpiryTimer( siteId );
	entries.set( siteId, { ...current, phase, message: getPushPhaseMessage( phase, progress ) } );
	emit();
}

export function reportSyncCancelled( siteId: string, direction: SyncDirection ): void {
	entries.set( siteId, { kind: 'cancelled', direction } );
	scheduleExpiry( siteId );
	emit();
}

/**
 * Whether the in-flight operation can still be stopped. Mirrors the legacy
 * renderer: a push is cancellable until the remote import is initiated, a pull
 * until the CLI starts writing the local site.
 */
export function canCancelSyncActivity( activity: SyncActivity | null ): boolean {
	if ( activity?.kind !== 'pending' ) {
		return false;
	}
	if ( activity.direction === 'push' ) {
		return canCancelPush( activity.phase );
	}
	if ( activity.direction === 'pull' ) {
		return canCancelPull( activity.action );
	}
	return false;
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

/**
 * Wording for the cancel affordance, or null when there is nothing to cancel.
 * Shared by the dropdown trigger (always visible while a sync runs) and the
 * progress panel inside the dropdown, so both read identically.
 */
export function getSyncCancelLabels(
	activity: SyncActivity | null
): { label: string; enabled: boolean } | null {
	if ( activity?.kind !== 'pending' ) {
		return null;
	}

	const enabled = canCancelSyncActivity( activity );
	if ( activity.direction === 'push' ) {
		return {
			enabled,
			label: enabled
				? __( 'Cancel push' )
				: __( 'Push can not be cancelled while applying changes to the remote site' ),
		};
	}
	if ( activity.direction === 'pull' ) {
		return {
			enabled,
			label: enabled
				? __( 'Cancel pull' )
				: __( 'Pull can not be cancelled while importing changes to your local site' ),
		};
	}
	// Only push and pull can be stopped — a preview or an import offers nothing.
	return null;
}
