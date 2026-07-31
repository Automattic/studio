import { __, sprintf } from '@wordpress/i18n';
import { formatRelativeTime } from '@/lib/format-relative-time';
import type { SyncSite } from '@/data/core';
import type { AgenticFeatureReason } from '@/data/queries/use-agentic-features';
import type { SyncActivity } from '@/data/sync-activity';

const MINUTE_MS = 60_000;

export type ToolbarActionId = 'publish' | 'sync' | 'login';

export type ToolbarAction = {
	id: ToolbarActionId;
	// The action's name, and its accessible name: push and pull are icon-only.
	label: string;
	variant: 'solid' | 'outline';
	tone: 'brand' | 'neutral';
	// Spinner in place of the icon: this action's own work is running.
	busy: boolean;
	// 0–100. Present only while this action reports real byte progress, so the
	// button can fill rather than pretending to know how long a phase takes.
	progress?: number;
	// The tooltip: when this action last ran, or — when it can't run — why not,
	// so a dead button never goes quiet without saying something. The button's
	// own name lives in its accessible label.
	hint?: string;
	disabled: boolean;
};

export type ToolbarState = {
	// Everything the site can do right now, in the order it should be shown.
	// A connected site offers both directions at once, so neither is a mode
	// that can be left pointing the wrong way.
	actions: ToolbarAction[];
};

export type DeriveToolbarStateOptions = {
	activity: SyncActivity | null;
	agenticEnabled: boolean;
	agenticReason: AgenticFeatureReason;
	// Every WordPress.com site this local site is connected to.
	connections: SyncSite[];
	// True while any push/pull/preview mutation for this site is in flight;
	// they all mutate the same runtime, so one blocks the others.
	isSyncing: boolean;
	siteRunning: boolean;
};

/**
 * The shortest readable age: "3s", "4m", "2h", "6d". Seconds matter here — a
 * sync is often checked moments after it lands, and "just now" holds for a
 * whole minute. Returns null for timestamps we can't read.
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

/** The newest of one timestamp across every connection. */
function newestTimestamp(
	connections: SyncSite[],
	read: ( site: SyncSite ) => string | null
): string | null {
	let newest: { iso: string; ms: number } | null = null;
	for ( const connection of connections ) {
		const iso = read( connection );
		const ms = Date.parse( iso ?? '' );
		if ( iso && Number.isFinite( ms ) && ( ! newest || ms > newest.ms ) ) {
			newest = { iso, ms };
		}
	}
	return newest?.iso ?? null;
}

/**
 * Maps everything the toolbar knows about a site onto the buttons it can
 * offer. Kept free of hooks and rendering so the whole table can be asserted
 * in tests.
 *
 * There is no status line: progress lives in the buttons' own fill, and
 * results are announced as app toasts.
 */
export function deriveToolbarState( {
	activity,
	agenticEnabled,
	agenticReason,
	connections,
	isSyncing,
	siteRunning,
}: DeriveToolbarStateOptions ): ToolbarState {
	// Signed out, nothing remote is reachable and the fix is a single click.
	if ( agenticReason === 'signed-out' ) {
		return {
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

	if ( connections.length === 0 ) {
		return {
			actions: [
				// Publish only opens the site picker, so the gates below — which are
				// about moving files off a local server — don't apply to it.
				{
					id: 'publish',
					label: __( 'Publish' ),
					variant: 'solid',
					tone: 'brand',
					busy: false,
					disabled: false,
					hint: __( 'Connect to WordPress.com or Pressable' ),
				},
			],
		};
	}

	// One gate: push and pull move the same files over the same connection, so
	// whatever stops one stops the other, and they now share a button.
	const blockedReason = ( () => {
		if ( agenticReason === 'offline' ) {
			return __( 'Go online to sync this site.' );
		}
		if ( ! agenticEnabled ) {
			return __( 'Unavailable right now.' );
		}
		if ( ! siteRunning ) {
			return __( 'Start the site to sync it.' );
		}
		return undefined;
	} )();

	const lastPush = formatSyncTimestamp(
		newestTimestamp( connections, ( site ) => site.lastPushTimestamp )
	);
	const lastPull = formatSyncTimestamp(
		newestTimestamp( connections, ( site ) => site.lastPullTimestamp )
	);

	// The button reports the site's freshest sync in either direction: which way
	// it went last is more useful than two separate never-ran states.
	const history = ( () => {
		if ( lastPush ) {
			// translators: %s: compact relative time, e.g. "6d".
			return sprintf( __( 'Pushed %s ago' ), lastPush );
		}
		if ( lastPull ) {
			// translators: %s: compact relative time, e.g. "6d".
			return sprintf( __( 'Pulled %s ago' ), lastPull );
		}
		return __( 'Never synced' );
	} )();

	const running = activity?.kind === 'pending' && activity.direction !== 'preview';

	return {
		actions: [
			{
				id: 'sync',
				label: __( 'Sync' ),
				variant: 'solid',
				tone: 'brand',
				busy: running,
				disabled: ! running && ( blockedReason !== undefined || isSyncing ),
				...( running && activity.progress !== undefined ? { progress: activity.progress } : {} ),
				hint: running
					? undefined
					: blockedReason ?? ( isSyncing ? __( 'Another sync is already running.' ) : history ),
			},
		],
	};
}
