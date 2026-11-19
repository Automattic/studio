import { __, sprintf } from '@wordpress/i18n';
import { useSyncExternalStore } from 'react';
import type { SyncActivity as CliSyncActivity } from '@studio/common/lib/sync/activity';
import type { PushPhase } from '@studio/common/types/sync';

export type SyncActivity = CliSyncActivity;

// In-flight and recently finished syncs and imports per site, fed by the
// activity the CLI publishes. Module-level so it survives remounts during
// navigation.

// How long success/error stay visible before the indicator vanishes.
// Matches the 30s requirement from the UX spec.
const RESULT_TTL_MS = 30_000;

const entries = new Map< string, SyncActivity >();
const runIds = new Map< string, number >();
let nextRunId = 1;
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
		runIds.delete( siteId );
		emit();
	}, RESULT_TTL_MS );
	timers.set( siteId, timer );
}

// The percentage goes in the message because that is how a pull already reads
// here — the CLI puts it in its own text.
function getPushPhaseMessage( phase: PushPhase, progress?: number ): string {
	const message = {
		creatingBackup: __( 'Creating backup…' ),
		uploading: __( 'Uploading site…' ),
		creatingRemoteBackup: __( 'Backing up remote site…' ),
		applyingChanges: __( 'Applying changes…' ),
		finishing: __( 'Almost there…' ),
		launching: __( 'Launching site…' ),
	}[ phase ];

	return progress ? sprintf( '%1$s (%2$d%%)', message, Math.round( progress ) ) : message;
}

/**
 * Records what a site's sync is doing. Returns whether this settled a sync that
 * was still pending, so each result is announced once however many times it is
 * reported.
 */
export function applySyncActivity( siteId: string, activity: SyncActivity ): boolean {
	const previous = entries.get( siteId );
	const wasPending = previous?.kind === 'pending';
	if (
		wasPending &&
		( ( activity.kind !== 'pending' && activity.direction !== previous.direction ) ||
			( activity.direction === previous.direction &&
				( ( activity.provider && previous.provider && activity.provider !== previous.provider ) ||
					( activity.remoteSiteId !== undefined &&
						previous.remoteSiteId !== undefined &&
						String( activity.remoteSiteId ) !== String( previous.remoteSiteId ) ) ) ) )
	)
		return false;
	if ( activity.kind === 'pending' ) {
		if ( ! wasPending || previous.direction !== activity.direction ) {
			runIds.set( siteId, nextRunId++ );
		} else if ( ! activity.provider || activity.provider === previous.provider ) {
			// The UI can know the destination before the CLI reports it.
			activity = {
				...activity,
				provider: activity.provider ?? previous.provider,
				remoteSiteId: activity.remoteSiteId ?? previous.remoteSiteId,
			};
		}
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
		// A result is for the site and provider its run targeted.
		entries.set( siteId, {
			...activity,
			remoteSiteId: activity.remoteSiteId ?? previous.remoteSiteId,
			provider: activity.provider ?? previous.provider,
		} );
		scheduleExpiry( siteId );
	}
	emit();
	return activity.kind !== 'pending';
}

export function getSyncActivity( siteId: string ): SyncActivity | undefined {
	return entries.get( siteId );
}

export function getSyncActivityRunId( siteId: string ): number | undefined {
	return runIds.get( siteId );
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
