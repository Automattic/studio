import { __, sprintf } from '@wordpress/i18n';
import { formatRelativeTime } from '@/lib/format-relative-time';
import type { SyncModeDirection } from './use-sync-mode';
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

export type ToolbarActionId = 'publish' | 'push' | 'pull' | 'retry' | 'login';

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
	// history to report, and "No live site" only restates the Publish button.
	status: ToolbarStatus | null;
	action: ToolbarAction;
};

export type DeriveToolbarStateOptions = {
	activity: SyncActivity | null;
	// Which way the action moves content. A mode the user sets from the action
	// button's own menu, not something the app infers.
	direction: SyncModeDirection;
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
	direction,
	agenticEnabled,
	agenticReason,
	liveSite,
	isSyncing,
	siteRunning,
}: DeriveToolbarStateOptions ): ToolbarState {
	// Only the direction the button is set to counts: a failed pull shouldn't
	// turn a Push button into Retry, and vice versa.
	const isRunningNow = activity?.kind === 'pending' && activity.direction === direction;
	const hasFailed = activity?.kind === 'error' && activity.direction === direction;

	// Signed out: nothing remote is reachable and the fix is a single click,
	// so it outranks every other story the pill could tell.
	if ( agenticReason === 'signed-out' ) {
		return {
			status: { tone: 'neutral', label: __( 'Sign in to publish' ) },
			action: {
				id: 'login',
				label: __( 'Log in' ),
				variant: 'solid',
				tone: 'brand',
				busy: false,
				disabled: false,
			},
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
		// online keeps reporting its own progress.
		if ( agenticReason === 'offline' ) {
			return { tone: 'neutral' as const, label: __( 'Offline' ) };
		}
		return getIdleStatus( liveSite );
	} )();

	const action: ToolbarAction = ( () => {
		if ( ! liveSite ) {
			return {
				id: 'publish' as const,
				label: __( 'Publish' ),
				variant: 'solid' as const,
				tone: 'brand' as const,
				busy: false,
				disabled: false,
			};
		}

		// A failure keeps its recovery in the same slot the action lived in, so
		// the fix is exactly where the user was already looking.
		if ( hasFailed ) {
			return {
				id: 'retry' as const,
				label: __( 'Retry' ),
				variant: 'solid' as const,
				tone: 'brand' as const,
				busy: false,
				disabled: false,
			};
		}

		return {
			id: direction,
			label: direction === 'pull' ? __( 'Pull' ) : __( 'Push' ),
			variant: 'solid' as const,
			tone: 'brand' as const,
			busy: isRunningNow,
			disabled: false,
		};
	} )();

	// Gating runs last so every branch above states its intent and this one
	// decides, in one place, whether it can actually happen.
	const disabledReason = ( () => {
		if ( action.busy ) {
			return undefined;
		}
		if ( agenticReason === 'offline' ) {
			return __( 'Go online to sync this site.' );
		}
		if ( ! agenticEnabled ) {
			return __( 'Unavailable right now.' );
		}
		if ( isSyncing ) {
			return __( 'Another sync is already running.' );
		}
		// Publish only opens the site picker, so the gates below — which are
		// about moving files off a local server — don't apply to it.
		if ( action.id === 'publish' ) {
			return undefined;
		}
		if ( ! siteRunning ) {
			return __( 'Start the site to sync it.' );
		}
		return undefined;
	} )();

	return {
		status,
		action: {
			...action,
			disabled: disabledReason !== undefined,
			...( disabledReason === undefined ? {} : { disabledReason } ),
		},
	};
}
