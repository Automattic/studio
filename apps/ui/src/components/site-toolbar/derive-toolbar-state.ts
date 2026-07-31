import { __, sprintf } from '@wordpress/i18n';
import { formatRelativeTime } from '@/lib/format-relative-time';
import type { SyncSite } from '@/data/core';
import type { AgenticFeatureReason } from '@/data/queries/use-agentic-features';
import type { SyncActivity } from '@/data/sync-activity';

const MINUTE_MS = 60_000;

export type ToolbarStatusTone = 'neutral' | 'pending' | 'success' | 'error' | 'warning';

export type ToolbarStatus = {
	tone: ToolbarStatusTone;
	label: string;
	// Trailing muted fragment after a middot — a relative timestamp, mostly.
	meta?: string;
	// 0–100. Present only while an upload reports real byte progress, so the
	// pill can fill rather than pretending to know how long a phase will take.
	progress?: number;
	// Longer explanation for the pill's menu: an error message, or what the
	// current phase is actually doing.
	detail?: string;
};

export type ToolbarActionId = 'publish' | 'push' | 'pull' | 'login';

export type ToolbarAction = {
	id: ToolbarActionId;
	label: string;
	variant: 'solid' | 'outline';
	tone: 'brand' | 'neutral';
	// Spinner in place of the label: this action's own work is running.
	busy: boolean;
	disabled: boolean;
	// Tooltip explaining a disabled action, so the button never goes quiet
	// without saying why.
	disabledReason?: string;
};

export type ToolbarState = {
	// Null when there is nothing worth saying: an unconnected site has no sync
	// history to report, and naming that state only restates the button.
	status: ToolbarStatus | null;
	// Everything the site can do right now, in the order it should be shown.
	// A connected site offers both directions at once, so neither is a mode
	// that can be left pointing the wrong way.
	actions: ToolbarAction[];
};

export type DeriveToolbarStateOptions = {
	activity: SyncActivity | null;
	agenticEnabled: boolean;
	agenticReason: AgenticFeatureReason;
	liveSite: SyncSite | undefined;
	// True while any push/pull/preview mutation for this site is in flight;
	// they all mutate the same runtime, so one blocks the others.
	isSyncing: boolean;
	siteRunning: boolean;
};

/**
 * The live site's name in running prose: staging environments are worth
 * naming (pushing to staging and pushing to production are very different
 * acts), everything else is just "live".
 */
function getTargetName( liveSite: SyncSite | undefined ): string {
	return liveSite?.isStaging ? __( 'Staging' ) : __( 'live' );
}

/**
 * The shortest readable age for the pill's trailing meta: "3s", "4m", "2h",
 * "6d". Seconds matter here — the pill is often read moments after a push, and
 * "just now" holds for a whole minute. Returns null for timestamps we can't
 * read, so the caller drops the fragment rather than rendering an empty one.
 */
export function formatSyncTimestamp( isoTimestamp: string | null | undefined ): string | null {
	if ( ! isoTimestamp ) {
		return null;
	}
	const timestampMs = Date.parse( isoTimestamp );
	if ( ! Number.isFinite( timestampMs ) ) {
		return null;
	}
	const elapsedMs = Math.max( 0, Date.now() - timestampMs );
	if ( elapsedMs < MINUTE_MS ) {
		return sprintf(
			// translators: %d: number of seconds, compact relative time (e.g. "3s").
			__( '%ds' ),
			Math.max( 1, Math.floor( elapsedMs / 1000 ) )
		);
	}
	return formatRelativeTime( new Date( timestampMs ).toISOString() ) || null;
}

/** The same, for the moment an activity reported in. */
function formatActivityAge( at: number | undefined ): string | undefined {
	return formatSyncTimestamp( new Date( at ?? Date.now() ).toISOString() ) ?? undefined;
}

function getPendingStatus( activity: Extract< SyncActivity, { kind: 'pending' } > ): ToolbarStatus {
	if ( activity.direction === 'preview' ) {
		return { tone: 'pending', label: __( 'Publishing preview…' ) };
	}

	if ( activity.direction === 'pull' ) {
		return {
			tone: 'pending',
			label: __( 'Pulling from live…' ),
			progress: activity.progress,
			detail: activity.message,
		};
	}

	// Push labels itself from the phase rather than a backend string, so the
	// copy stays translatable and consistent with the rest of the toolbar.
	if ( activity.phase === 'uploading' && activity.progress !== undefined ) {
		return {
			tone: 'pending',
			label: sprintf(
				// translators: %d: upload progress percentage.
				__( 'Uploading… %d%%' ),
				Math.round( activity.progress )
			),
			progress: activity.progress,
			detail: __( 'Uploading your site to WordPress.com.' ),
		};
	}

	if ( activity.phase === 'paused' ) {
		return {
			tone: 'warning',
			label: __( 'Upload paused' ),
			progress: activity.progress,
			detail: __( 'Waiting for the network. The upload resumes on its own.' ),
		};
	}

	if ( activity.phase === 'importing' ) {
		return {
			tone: 'pending',
			label: __( 'Applying changes…' ),
			detail: __( 'WordPress.com is unpacking the upload.' ),
		};
	}

	return {
		tone: 'pending',
		label: activity.phase === 'uploading' ? __( 'Uploading…' ) : __( 'Preparing…' ),
		detail: __( 'Packaging your site.' ),
	};
}

function getSuccessStatus(
	activity: Extract< SyncActivity, { kind: 'success' } >,
	liveSite: SyncSite | undefined
): ToolbarStatus {
	const meta = formatActivityAge( activity.at );

	if ( activity.direction === 'preview' ) {
		return { tone: 'success', label: __( 'Preview published' ), meta };
	}
	if ( activity.direction === 'pull' ) {
		return {
			tone: 'success',
			// translators: %s: the live site's name, e.g. "live" or "Staging".
			label: sprintf( __( 'Pulled from %s' ), getTargetName( liveSite ) ),
			meta,
		};
	}
	return {
		tone: 'success',
		// translators: %s: the live site's name, e.g. "live" or "Staging".
		label: sprintf( __( 'Pushed to %s' ), getTargetName( liveSite ) ),
		meta,
	};
}

function getErrorStatus( activity: Extract< SyncActivity, { kind: 'error' } > ): ToolbarStatus {
	const label =
		activity.direction === 'preview'
			? __( 'Preview failed' )
			: activity.direction === 'pull'
			? __( 'Pull failed' )
			: __( 'Push failed' );

	return {
		tone: 'error',
		label,
		meta: formatActivityAge( activity.at ),
		detail: activity.message,
	};
}

/**
 * The steady-state pill: what happened last, and when. Falls back through
 * push history, then pull history, then "never pushed" for a freshly
 * connected site.
 */
function getIdleStatus( liveSite: SyncSite | undefined ): ToolbarStatus | null {
	if ( ! liveSite ) {
		return null;
	}

	const target = getTargetName( liveSite );
	const pushedAt = formatSyncTimestamp( liveSite.lastPushTimestamp );
	if ( pushedAt ) {
		return {
			tone: 'neutral',
			// translators: %s: the live site's name, e.g. "live" or "Staging".
			label: sprintf( __( 'Pushed to %s' ), target ),
			meta: pushedAt,
		};
	}

	const pulledAt = formatSyncTimestamp( liveSite.lastPullTimestamp );
	if ( pulledAt ) {
		return {
			tone: 'neutral',
			// translators: %s: the live site's name, e.g. "live" or "Staging".
			label: sprintf( __( 'Pulled from %s' ), target ),
			meta: pulledAt,
		};
	}

	return { tone: 'neutral', label: __( 'Never pushed' ) };
}

/**
 * Maps everything the toolbar knows about a site onto exactly two things: a
 * status pill and a single primary action. Kept free of hooks and rendering
 * so the whole state table can be asserted in tests.
 */
export function deriveToolbarState( {
	activity,
	agenticEnabled,
	agenticReason,
	liveSite,
	isSyncing,
	siteRunning,
}: DeriveToolbarStateOptions ): ToolbarState {
	// Signed out, nothing remote is reachable and the fix is a single click.
	if ( agenticReason === 'signed-out' ) {
		return {
			status: null,
			actions: [
				{
					id: 'login',
					label: __( 'Log in' ),
					variant: 'solid',
					tone: 'brand',
					busy: false,
					disabled: false,
				},
			],
		};
	}

	const status: ToolbarStatus | null = ( () => {
		if ( activity?.kind === 'pending' ) {
			return getPendingStatus( activity );
		}
		if ( activity?.kind === 'error' ) {
			return getErrorStatus( activity );
		}
		if ( activity?.kind === 'success' ) {
			return getSuccessStatus( activity, liveSite );
		}
		// Offline only shows once nothing is in flight — a push that started
		// online keeps reporting its own progress — and only for a site that has
		// somewhere to sync to.
		if ( agenticReason === 'offline' ) {
			return liveSite ? { tone: 'neutral' as const, label: __( 'Offline' ) } : null;
		}
		return getIdleStatus( liveSite );
	} )();

	// Gating is shared: push and pull move the same files over the same
	// connection, so whatever stops one stops the other.
	const disabledReason = ( () => {
		if ( agenticReason === 'offline' ) {
			return __( 'Go online to sync this site.' );
		}
		if ( ! agenticEnabled ) {
			return __( 'Unavailable right now.' );
		}
		if ( isSyncing ) {
			return __( 'Another sync is already running.' );
		}
		if ( ! siteRunning ) {
			return __( 'Start the site to sync it.' );
		}
		return undefined;
	} )();

	const gate = ( action: Omit< ToolbarAction, 'disabled' > ): ToolbarAction => ( {
		...action,
		// A running action isn't blocked by its own run.
		disabled: ! action.busy && disabledReason !== undefined,
		...( action.busy || disabledReason === undefined ? {} : { disabledReason } ),
	} );

	if ( ! liveSite ) {
		return {
			status,
			actions: [
				// Publish only opens the site picker, so the gates above — which are
				// about moving files off a local server — don't apply to it.
				{
					id: 'publish',
					label: __( 'Publish' ),
					variant: 'solid',
					tone: 'brand',
					busy: false,
					disabled: false,
				},
			],
		};
	}

	const isPushing = activity?.kind === 'pending' && activity.direction === 'push';
	const isPulling = activity?.kind === 'pending' && activity.direction === 'pull';

	// Pull sits on the left and stays quiet: it overwrites local work, so it
	// shouldn't be the button the eye lands on first.
	return {
		status,
		actions: [
			gate( {
				id: 'pull',
				label: __( 'Pull' ),
				variant: 'outline',
				tone: 'neutral',
				busy: isPulling,
			} ),
			gate( {
				id: 'push',
				label: __( 'Push' ),
				variant: 'solid',
				tone: 'brand',
				busy: isPushing,
			} ),
		],
	};
}
