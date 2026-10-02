import { canCancelPull, canCancelPush } from '@studio/common/lib/sync/cancel';
import { __, sprintf } from '@wordpress/i18n';
import { useSyncExternalStore } from 'react';
import type { SyncActivity } from '@studio/common/lib/sync/activity';
import type { PushPhase } from '@studio/common/types/sync';

export type { SyncActivity, SyncDirection } from '@studio/common/lib/sync/activity';

// In-flight and recently finished syncs and imports per site, fed by the
// activity the CLI publishes. Module-level so it survives remounts during
// navigation.

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

/**
 * Records what a site's sync is doing. Returns whether this settled a sync that
 * was still pending, so each result is announced once however many times it is
 * reported.
 */
export function applySyncActivity( siteId: string, activity: SyncActivity ): boolean {
	const wasPending = entries.get( siteId )?.kind === 'pending';
	if ( activity.kind === 'pending' ) {
		clearExpiryTimer( siteId );
		entries.set(
			siteId,
			activity.phase
				? { ...activity, message: getPushPhaseMessage( activity.phase, activity.progress ) }
				: activity
		);
	} else {
		if ( ! wasPending ) {
			return false;
		}
		entries.set( siteId, activity );
		scheduleExpiry( siteId );
	}
	emit();
	return activity.kind !== 'pending';
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
