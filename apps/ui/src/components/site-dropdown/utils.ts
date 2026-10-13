import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS, HOUR_MS } from '@studio/common/constants';
import { type SiteOperationKind } from '@studio/common/lib/site-operation';
import { getSiteOperationLabel } from '@studio/common/lib/site-operation-labels';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import type { SiteStatus } from './dropdown-trigger';
import type { SiteDetails, Snapshot, SyncSite } from '@/data/core';

export function stripProtocol( url: string ): string {
	return url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

export function ensureProtocol( url: string ): string {
	return /^https?:\/\//.test( url ) ? url : `https://${ url }`;
}

export function pickLiveSite( connectedSites: SyncSite[] | undefined ): SyncSite | undefined {
	if ( ! connectedSites || connectedSites.length === 0 ) {
		return undefined;
	}
	// Prefer the production (non-staging) site; fall back to anything connected
	// so a staging-only link is still surfaced rather than silently dropped.
	return connectedSites.find( ( site ) => ! site.isStaging ) ?? connectedSites[ 0 ];
}

export function getSiteSnapshots( snapshots: Snapshot[] | undefined, siteId: string ): Snapshot[] {
	return ( snapshots ?? [] )
		.filter( ( snapshot ) => snapshot.localSiteId === siteId )
		.sort( ( a, b ) => b.date - a.date );
}

// "now", "5 minutes ago", "yesterday", "in 7 days": the largest whole unit that fits.
function formatRelativeDate( timestampMs: number, now: number, locale?: string ): string {
	const diff = timestampMs - now;
	const format = new Intl.RelativeTimeFormat( locale, { numeric: 'auto', style: 'short' } );
	if ( Math.abs( diff ) < 60_000 ) {
		return format.format( 0, 'second' );
	}
	if ( Math.abs( diff ) < HOUR_MS ) {
		return format.format( Math.round( diff / 60_000 ), 'minute' );
	}
	if ( Math.abs( diff ) < DAY_MS ) {
		return format.format( Math.round( diff / HOUR_MS ), 'hour' );
	}
	return format.format( Math.round( diff / DAY_MS ), 'day' );
}

export function getSnapshotExpiry( snapshot: Snapshot ): number {
	return snapshot.date + DEMO_SITE_EXPIRATION_DAYS * DAY_MS;
}

export function getSnapshotTimesLabel(
	snapshot: Snapshot,
	locale?: string,
	now = Date.now()
): string {
	return sprintf(
		/* translators: 1: when the preview was last updated, e.g. "5 minutes ago". 2: when it expires, e.g. "in 7 days". */
		__( 'Updated %1$s · expires %2$s' ),
		formatRelativeDate( snapshot.date, now, locale ),
		formatRelativeDate( getSnapshotExpiry( snapshot ), now, locale )
	);
}

export function getSnapshotDatesLabel( snapshot: Snapshot, locale?: string ): string {
	const format = new Intl.DateTimeFormat( locale, { dateStyle: 'medium', timeStyle: 'short' } );
	return sprintf(
		/* translators: 1: when the preview was last updated, e.g. "Oct 4, 2026, 9:23 AM". 2: when it expires, e.g. "Oct 11, 2026, 9:23 AM". */
		__( 'Updated on %1$s, expires on %2$s' ),
		format.format( snapshot.date ),
		format.format( getSnapshotExpiry( snapshot ) )
	);
}

export function getSnapshotExpiredLabel(
	snapshot: Snapshot,
	locale?: string,
	now = Date.now()
): string {
	return sprintf(
		/* translators: %s: when the preview expired, e.g. "1 day ago". */
		__( 'Expired %s' ),
		formatRelativeDate( getSnapshotExpiry( snapshot ), now, locale )
	);
}

export function pickLatestSnapshot(
	snapshots: Snapshot[] | undefined,
	siteId: string
): Snapshot | undefined {
	return getSiteSnapshots( snapshots, siteId )[ 0 ];
}

// `Snapshot.url` is stored as a bare hostname. The CLI `preview update`
// subcommand expects that same hostname as its positional arg, so use this
// helper when passing a snapshot back to publish/update actions — otherwise
// an `https://…/` prefix would cause the command to spawn a new preview.
export function getSnapshotHostname( snapshot: Snapshot ): string {
	return stripProtocol( snapshot.url );
}

// Short status name for a site's toggle/tooltip: "Running", "Stopping",
// "Saving settings". Shared with the sidebar so the two can't word it
// differently.
//
// `starting`/`stopping` and `operation` overlap but neither covers the other:
// the first two are this window's in-flight mutations, which land the moment
// the user clicks, while `operation` is what the CLI recorded — a round-trip
// later, but the only one that sees work the agent or another window started.
export function getSiteStatusName( {
	running,
	starting,
	stopping,
	operation,
}: {
	running: boolean;
	starting: boolean;
	stopping: boolean;
	operation: SiteOperationKind | null;
} ): string {
	if ( operation ) {
		return getSiteOperationLabel( operation );
	}
	if ( stopping ) {
		return __( 'Stopping' );
	}
	if ( starting ) {
		return __( 'Starting' );
	}
	return running ? __( 'Running' ) : __( 'Stopped' );
}

function getStatus(
	site: SiteDetails,
	isStarting: boolean,
	isStopping: boolean,
	operation: SiteOperationKind | null
): SiteStatus {
	if ( operation || isStarting || isStopping ) {
		return 'transitioning';
	}
	return site.running ? 'running' : 'stopped';
}

// Sentence form, read out by the status dot's aria-label.
function getStatusLabel(
	status: SiteStatus,
	isStopping: boolean,
	operation: SiteOperationKind | null
): string {
	if ( operation ) {
		return getSiteOperationLabel( operation );
	}
	if ( status === 'running' ) {
		return __( 'Site is running' );
	}
	if ( status === 'stopped' ) {
		return __( 'Site is stopped' );
	}
	return isStopping ? __( 'Site is stopping' ) : __( 'Site is starting' );
}

// The local-site row's second line: what's happening, or where the site lives.
function getLocalSublabel(
	site: SiteDetails,
	status: SiteStatus,
	isStopping: boolean,
	operation: SiteOperationKind | null
): string {
	if ( operation ) {
		// translators: %s: an operation in progress, e.g. "Saving settings".
		return sprintf( __( '%s…' ), getSiteOperationLabel( operation ) );
	}
	if ( status !== 'transitioning' ) {
		return getSiteDisplayUrl( site );
	}
	return isStopping ? __( 'Stopping…' ) : __( 'Starting…' );
}

// Derives the running/transitioning/stopped status plus the user-visible
// labels for the local-site row, so the dropdown consumes it in one line.
export function deriveSiteStatus(
	site: SiteDetails,
	isStarting: boolean,
	isStopping: boolean,
	// From `useSiteOperation`; see `getSiteStatusName` for why this doesn't
	// replace the two flags above. Passed in rather than derived here because
	// it's react-query state and this stays a pure function.
	operation: SiteOperationKind | null
): { status: SiteStatus; statusLabel: string; localSublabel: string } {
	const status = getStatus( site, isStarting, isStopping, operation );

	return {
		status,
		statusLabel: getStatusLabel( status, isStopping, operation ),
		localSublabel: getLocalSublabel( site, status, isStopping, operation ),
	};
}
