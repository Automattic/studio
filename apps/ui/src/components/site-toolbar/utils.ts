import { type SiteOperationKind } from '@studio/common/lib/site-operation';
import { getSiteOperationLabel } from '@studio/common/lib/site-operation-labels';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import type { SiteRunStatus } from '@/components/site-status-button';
import type { SiteDetails, Snapshot, SyncSite } from '@/data/core';

export function stripProtocol( url: string ): string {
	return url.replace( /^https?:\/\//, '' ).replace( /\/$/, '' );
}

export function ensureProtocol( url: string ): string {
	return /^https?:\/\//.test( url ) ? url : `https://${ url }`;
}

/** The single connection the header's sync and disconnect actions target. */
export function pickLiveSite( connectedSites: SyncSite[] | undefined ): SyncSite | undefined {
	if ( ! connectedSites || connectedSites.length === 0 ) {
		return undefined;
	}
	// Prefer the production (non-staging) site; fall back to anything connected
	// so a staging-only link is still surfaced rather than silently dropped.
	return connectedSites.find( ( site ) => ! site.isStaging ) ?? connectedSites[ 0 ];
}

export function pickLatestSnapshot(
	snapshots: Snapshot[] | undefined,
	siteId: string
): Snapshot | undefined {
	if ( ! snapshots ) {
		return undefined;
	}
	// `date` is a unix timestamp; the most recent snapshot wins.
	return snapshots
		.filter( ( snapshot ) => snapshot.localSiteId === siteId )
		.reduce< Snapshot | undefined >( ( latest, candidate ) => {
			if ( ! latest || candidate.date > latest.date ) {
				return candidate;
			}
			return latest;
		}, undefined );
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
): SiteRunStatus {
	if ( operation || isStarting || isStopping ) {
		return 'transitioning';
	}
	return site.running ? 'running' : 'stopped';
}

// Sentence form, read out by the status dot's aria-label.
function getStatusLabel(
	status: SiteRunStatus,
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
	status: SiteRunStatus,
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
// labels for local-site controls.
export function deriveSiteStatus(
	site: SiteDetails,
	isStarting: boolean,
	isStopping: boolean,
	// From `useSiteOperation`; see `getSiteStatusName` for why this doesn't
	// replace the two flags above. Passed in rather than derived here because
	// it's react-query state and this stays a pure function.
	operation: SiteOperationKind | null
): { status: SiteRunStatus; statusLabel: string; localSublabel: string } {
	const status = getStatus( site, isStarting, isStopping, operation );

	return {
		status,
		statusLabel: getStatusLabel( status, isStopping, operation ),
		localSublabel: getLocalSublabel( site, status, isStopping, operation ),
	};
}
