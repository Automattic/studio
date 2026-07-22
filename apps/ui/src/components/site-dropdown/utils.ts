import { DAY_MS, DEMO_SITE_EXPIRATION_DAYS } from '@studio/common/constants';
import { __ } from '@wordpress/i18n';
import { getSiteDisplayUrl } from '@/lib/get-site-url';
import type { SiteStatus } from './dropdown-trigger';
import type { SiteDetails, Snapshot, SyncSite } from '@/data/core';

const UNIX_SECONDS_CUTOFF = 10_000_000_000;

// Older CLI versions stored snapshot dates as unix seconds; newer ones use
// milliseconds. Values below the cutoff can only be seconds.
export function normalizeSnapshotTimestamp( timestamp: number ): number {
	return timestamp < UNIX_SECONDS_CUTOFF ? timestamp * 1000 : timestamp;
}

// Mirrors the CLI's isSnapshotExpired (apps/cli/lib/snapshots.ts). The CLI
// refuses to update an expired preview site, so the UI must offer creating a
// new one instead of an update.
export function isSnapshotExpired( snapshot: Snapshot ): boolean {
	return (
		normalizeSnapshotTimestamp( snapshot.date ) + DEMO_SITE_EXPIRATION_DAYS * DAY_MS < Date.now()
	);
}

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

// Derives the running/transitioning/stopped status plus the user-visible
// labels for the local-site row. Collapses three related but noisy branches
// into a single helper the dropdown can consume in one line.
export function deriveSiteStatus(
	site: SiteDetails,
	isStarting: boolean,
	isStopping: boolean
): { status: SiteStatus; statusLabel: string; localSublabel: string } {
	const status: SiteStatus =
		isStarting || isStopping ? 'transitioning' : site.running ? 'running' : 'stopped';

	const statusLabel =
		status === 'running'
			? __( 'Site is running' )
			: status === 'transitioning'
			? isStopping
				? __( 'Site is stopping' )
				: __( 'Site is starting' )
			: __( 'Site is stopped' );

	const localSublabel =
		status === 'transitioning'
			? isStopping
				? __( 'Stopping…' )
				: __( 'Starting…' )
			: getSiteDisplayUrl( site );

	return { status, statusLabel, localSublabel };
}
