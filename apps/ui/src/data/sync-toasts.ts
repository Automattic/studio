import { __, sprintf } from '@wordpress/i18n';
import { showToast } from '@/data/app-messages';
import type { PullSiteProgress, PushSiteProgress } from '@/data/core';
import type { SyncDirection } from '@/data/sync-activity';

// A push or pull can run for minutes, and the site header only has room to
// spin. The running toast is where the detail goes — it stays pinned open,
// rewrites itself as the work moves through its phases, and is finally
// replaced in place by the result, so one message covers the whole operation.

function toastId( siteId: string ): string {
	return `sync-${ siteId }`;
}

// Push reports its upload byte-fraction many times a second; re-rendering the
// toast (and its aria-live announcer) that often thrashes. Coalesce progress
// updates to a steady cadence, always landing on the latest value.
const PROGRESS_THROTTLE_MS = 300;

type ThrottleState = { last: number; timer?: ReturnType< typeof setTimeout > };
const throttles = new Map< string, ThrottleState >();

function throttleProgress( siteId: string, run: () => void ): void {
	const state = throttles.get( siteId ) ?? { last: 0 };
	const elapsed = Date.now() - state.last;
	if ( state.timer ) {
		clearTimeout( state.timer );
		state.timer = undefined;
	}
	if ( elapsed >= PROGRESS_THROTTLE_MS ) {
		state.last = Date.now();
		throttles.set( siteId, state );
		run();
		return;
	}
	state.timer = setTimeout( () => {
		state.last = Date.now();
		state.timer = undefined;
		run();
	}, PROGRESS_THROTTLE_MS - elapsed );
	throttles.set( siteId, state );
}

// Cancels a pending throttled update so a stale progress frame can't land after
// the toast has already opened or been resolved.
function clearProgressThrottle( siteId: string ): void {
	const state = throttles.get( siteId );
	if ( state?.timer ) {
		clearTimeout( state.timer );
	}
	throttles.delete( siteId );
}

function runningTitle( direction: SyncDirection ): string {
	switch ( direction ) {
		case 'pull':
			return __( 'Pulling from live' );
		case 'preview':
			return __( 'Publishing preview link' );
		default:
			return __( 'Pushing to live' );
	}
}

/** Opens the running toast, before any progress has been reported. */
export function startSyncToast( siteId: string, direction: SyncDirection ): void {
	clearProgressThrottle( siteId );
	showToast( {
		id: toastId( siteId ),
		intent: 'info',
		title: runningTitle( direction ),
		description: direction === 'push' ? __( 'Preparing your site' ) : undefined,
		durationMs: 0,
	} );
}

/**
 * Push describes itself by phase rather than by a backend string, so the copy
 * stays translatable and consistent with the rest of the app.
 */
export function updatePushToast( siteId: string, progress: PushSiteProgress ): void {
	const description = ( () => {
		if ( progress.phase === 'uploading' ) {
			return progress.progress === undefined
				? __( 'Uploading…' )
				: sprintf(
						// translators: %d: upload progress percentage.
						__( 'Uploading… %d%%' ),
						Math.round( progress.progress )
				  );
		}
		if ( progress.phase === 'paused' ) {
			return __( 'Upload paused — waiting for the network' );
		}
		if ( progress.phase === 'importing' ) {
			return __( 'Applying changes on WordPress.com' );
		}
		return __( 'Preparing your site' );
	} )();

	throttleProgress( siteId, () =>
		showToast( {
			id: toastId( siteId ),
			intent: 'info',
			title: runningTitle( 'push' ),
			description,
			durationMs: 0,
		} )
	);
}

/** Pull has no phases of its own — the CLI narrates it. */
export function updatePullToast( siteId: string, progress: PullSiteProgress ): void {
	const description =
		progress.progress === undefined
			? progress.message
			: sprintf(
					// translators: 1: what the pull is doing, 2: percentage complete.
					__( '%1$s (%2$d%%)' ),
					progress.message,
					Math.round( progress.progress )
			  );

	throttleProgress( siteId, () =>
		showToast( {
			id: toastId( siteId ),
			intent: 'info',
			title: runningTitle( 'pull' ),
			description,
			durationMs: 0,
		} )
	);
}

/**
 * Replaces the running toast with its outcome, in place, so the result appears
 * where the user was already watching rather than as a second message.
 */
export function finishSyncToast(
	siteId: string,
	outcome: { intent: 'success' | 'error'; title: string; description?: string }
): void {
	clearProgressThrottle( siteId );
	showToast( { id: toastId( siteId ), ...outcome } );
}
